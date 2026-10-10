import "dotenv/config";
import { exec, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Redis } from "ioredis";
import { Worker } from "bullmq";
import { appHost, appPublicUrl } from "../services/appHost.js";
import { CaddyClient } from "../services/CaddyClient.js";
import { DeploymentStore } from "../services/DeploymentStore.js";
import { LogBus } from "../services/LogBus.js";
import {
  assertGitBranch,
  assertGitCommit,
  assertPublicGitHubRepo,
  deployResourceLimits,
  githubCloneUrl,
  redactSecrets,
  normalizeImageName,
} from "../services/DeployEngine.js";
import { DEPLOY_QUEUE_NAME, type DeployJobData } from "../queues/deployQueue.js";
import {
  selectEnv,
  variablesForDeployment,
  redactEnvValues,
} from "../services/projectEnv.js";
import { createRedis } from "../redis.js";
import { markDeploymentRunning } from "../services/deploymentLifetime.js";
import { syncDeployment } from "../services/syncDeployment.js";

const execAsync = promisify(exec);
const connection = createRedis();
const store = new DeploymentStore(connection);
const logs = new LogBus(connection);
const caddy = new CaddyClient();
const concurrency = Number(process.env.DEPLOY_CONCURRENCY ?? 5);
const HEALTH_TIMEOUT_MS = 20_000;
const WORKER_HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_INTERVAL_MS = 1_500;
const LOCK_DURATION_MS = 300_000;

async function finishDeployRecord(
  projectId: string,
  patch: { status: string; image?: string; port?: string; host?: string },
): Promise<void> {
  const current = await store.get(projectId);
  await store.update(projectId, {
    ...patch,
    ...(current?.finishedAt ? {} : { finishedAt: new Date().toISOString() }),
  });
}
const CONTAINER_INTERNAL_PORT = 8000;
const DEFAULT_RUNTIME_DATABASE_URL =
  process.env.DEPLOY_DEFAULT_DATABASE_URL?.trim() ||
  "postgresql://paas:paas@mi-paas-pgbouncer-1:6543/paas?schema=public";

const PORT_KEY_PREFIX = "deploy:port:";

const DEFAULT_DOCKERFILE = `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
ENV NODE_ENV=development
RUN npm install
COPY . .
# 1. Generar cliente de Prisma
RUN npx prisma generate
# 2. Compilar TypeScript
RUN npm run build
# 3. Copiar la carpeta generada a dist/ para runtime
RUN cp -r src/generated dist/ || true
EXPOSE 8000
CMD ["npm", "start"]
`;

function repoFile(dir: string, name: string): boolean {
  return fs.existsSync(path.join(dir, name));
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function readRepoText(dir: string, name: string): string {
  if (!repoFile(dir, name)) {
    return "";
  }
  return fs.readFileSync(path.join(dir, name), "utf8");
}

function usableCommand(value: string): string | null {
  const command = value.trim();
  if (!command || command.length > 500 || /[\r\n]/.test(command)) {
    return null;
  }
  return command;
}

function procfileCommand(dir: string, kind: "web" | "worker"): string | null {
  const pattern = kind === "worker" ? /^worker:\s*(.+)$/ : /^web:\s*(.+)$/;
  for (const line of readRepoText(dir, "Procfile").split(/\r?\n/)) {
    const match = pattern.exec(line.trim());
    if (!match) {
      continue;
    }
    return usableCommand(match[1]);
  }
  return null;
}

function renderStartCommand(dir: string): string | null {
  const match = /^\s*startCommand:\s*(.+)$/m.exec(readRepoText(dir, "render.yaml"));
  if (!match) {
    return null;
  }
  let command = match[1].trim();
  if (
    (command.startsWith('"') && command.endsWith('"')) ||
    (command.startsWith("'") && command.endsWith("'"))
  ) {
    command = command.slice(1, -1);
  }
  return usableCommand(command);
}

function pythonStartCommand(
  dir: string,
  options: { worker: boolean; startCommand?: string | null },
): { command: string; source: string } | null {
  if (options.worker) {
    const fromProcfile = procfileCommand(dir, "worker");
    if (fromProcfile) {
      return { command: fromProcfile, source: "Procfile worker:" };
    }
    const configured = usableCommand(options.startCommand ?? "");
    if (configured) {
      return { command: configured, source: "startCommand del proyecto" };
    }
  } else {
    const fromProcfile = procfileCommand(dir, "web");
    if (fromProcfile) {
      return { command: fromProcfile, source: "Procfile" };
    }
  }
  const fromRender = renderStartCommand(dir);
  if (fromRender) {
    return { command: fromRender, source: "render.yaml" };
  }
  if (repoFile(dir, "main.py")) {
    return { command: "python main.py", source: "main.py" };
  }
  if (repoFile(dir, "app.py")) {
    return { command: "python app.py", source: "app.py" };
  }
  return null;
}

function pythonDockerfile(command: string, pipCache: boolean, exposePort: boolean): string {
  const install = pipCache
    ? "RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt"
    : "RUN pip install --no-cache-dir -r requirements.txt";
  return [
    ...(pipCache ? ["# syntax=docker/dockerfile:1"] : []),
    "FROM python:3.11-slim",
    "WORKDIR /app",
    "COPY requirements.txt .",
    install,
    "COPY . .",
    ...(exposePort ? ["EXPOSE 8000"] : []),
    `CMD sh -c ${shellSingleQuote(command)}`,
    "",
  ].join("\n");
}

const GENERATED_DOCKERIGNORE = [
  ".git",
  "node_modules",
  "venv",
  ".venv",
  "__pycache__",
  ".next",
  "dist",
].join("\n");

function writeGeneratedDockerignore(dir: string): boolean {
  const ignorePath = path.join(dir, ".dockerignore");
  if (fs.existsSync(ignorePath)) {
    return false;
  }
  fs.writeFileSync(ignorePath, `${GENERATED_DOCKERIGNORE}\n`);
  return true;
}

const worker = new Worker<DeployJobData>(
  DEPLOY_QUEUE_NAME,
  async (job) => {
    const { projectId, repoUrl, projectName, deploymentId } = job.data;
    const branch = (job.data.branch ?? "main").trim() || "main";
    const commitHash = job.data.commitHash?.trim() || undefined;
    const clearCache = job.data.clearCache === true;
    const appName = dockerTag(job.data.image, projectName);
    const containerName = `paas-${projectId}`;
    const lines: string[] = [];
    const repoDir = repoDirectory(job.id);
    const startedAt = new Date();
    let cloned = false;

    const note = async (message: string) => {
      console.log(message);
      lines.push(message);
      await logs.append(projectId, message);
    };

    const recordDuration = async () => {
      const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));
      await syncDeployment(deploymentId, {
        durationSeconds,
        startedAt,
        stoppedAt: new Date(),
      });
    };

    await store.update(projectId, { status: "building" });
    await syncDeployment(deploymentId, { status: "building", branch });
    await note(`Construyendo ${appName}. Estado: building`);

    try {
      assertPublicGitHubRepo(repoUrl);
      assertGitBranch(branch);
      if (commitHash) {
        assertGitCommit(commitHash);
      }

      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.mkdirSync(repoDir, { recursive: true });

      const {
        variables,
        deploymentType,
        memoryLimit,
        cpuLimit,
        githubToken,
        customDomain,
        plainVariables,
        serviceType,
        startCommand,
      } = await variablesForDeployment(deploymentId);
      const isWorker = serviceType === "worker";
      await store.update(projectId, { serviceType });
      await note(`Tipo de servicio: ${serviceType}`);

      await note(`Clonando repositorio (rama ${branch})...`);
      const cloneUrl = githubCloneUrl(repoUrl, githubToken);
      await execAsync(`git clone -b "${branch}" --single-branch "${cloneUrl}" .`, {
        cwd: repoDir,
      });
      cloned = true;

      if (commitHash) {
        await note(`Checkout commit ${commitHash}...`);
        await execAsync(`git checkout "${commitHash}"`, {
          cwd: repoDir,
        });
      }

      const head = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
      const meta = execSync("git log -1 --pretty=format:%h%x09%s%x09%an", {
        cwd: repoDir,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
      const [shortHash = "", subject = "", author = ""] = meta.split("\t");
      const commitLabel = [
        shortHash || head.slice(0, 7),
        subject ? `- ${subject}` : "",
        author ? `(${author})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      await note(`Commit ${commitLabel}`);
      await syncDeployment(deploymentId, {
        commitHash: head,
        commitMessage: subject || null,
        commitAuthor: author || null,
        branch,
      });
      if (/^[a-f0-9]{7,40}$/i.test(head)) {
        await store.update(projectId, {
          commitHash: head,
          ...(subject ? { commitMessage: subject } : {}),
          ...(author ? { commitAuthor: author } : {}),
        });
      }

      console.log("Directorio del repo:", repoDir);
      const dockerfilePath = path.join(repoDir, "Dockerfile");
      let pythonRuntime = false;
      const hasDockerfile = repoFile(repoDir, "Dockerfile");
      const hasCompose = repoFile(repoDir, "docker-compose.yml") || repoFile(repoDir, "docker-compose.yaml");
      if (hasDockerfile || hasCompose) {
        if (!hasDockerfile) {
          await note("El repositorio trae docker-compose y no tiene Dockerfile. No se genera uno.");
          throw new Error("El repositorio trae docker-compose y no tiene Dockerfile");
        }
        await note("Usando el Dockerfile del repositorio");
      } else if (repoFile(repoDir, "requirements.txt")) {
        const start = pythonStartCommand(repoDir, { worker: isWorker, startCommand });
        if (!start) {
          const missing = isWorker
            ? "Falta comando de arranque: Procfile (worker:), startCommand del proyecto, render.yaml, main.py o app.py"
            : "Falta comando de arranque: Procfile (web:), render.yaml (startCommand), main.py o app.py";
          await note(missing);
          throw new Error(missing);
        }
        pythonRuntime = true;
        fs.writeFileSync(dockerfilePath, pythonDockerfile(start.command, !clearCache, !isWorker));
        const ignored = writeGeneratedDockerignore(repoDir);
        await note(
          `Dockerfile generado desde requirements.txt (Python). Comando desde ${start.source}: ${start.command}${ignored ? ". .dockerignore añadido." : ""}`,
        );
      } else if (repoFile(repoDir, "package.json")) {
        fs.writeFileSync(dockerfilePath, DEFAULT_DOCKERFILE);
        const ignored = writeGeneratedDockerignore(repoDir);
        await note(
          ignored
            ? "Dockerfile generado desde package.json (Node.js). .dockerignore añadido."
            : "Dockerfile generado desde package.json (Node.js)",
        );
      } else {
        await note("Falta Dockerfile, package.json o requirements.txt");
        throw new Error("Falta Dockerfile, package.json o requirements.txt");
      }

      const buildCmd = clearCache
        ? `docker build --no-cache -t "${appName}" .`
        : `docker build -t "${appName}" .`;
      await note(
        clearCache
          ? "Construyendo imagen (sin caché)..."
          : "Construyendo imagen...",
      );
      try {
        await execAsync(buildCmd, {
          cwd: repoDir,
          env: { ...process.env, DOCKER_BUILDKIT: "1" },
          maxBuffer: 32 * 1024 * 1024,
        });
      } catch (buildError) {
        const detail = commandError(buildError);
        await note(`docker build falló:\n${detail}`);
        throw buildError;
      }

      try {
        execSync(`docker stop "${containerName}"`, { stdio: "pipe" });
      } catch {
        // Contenedor previo inexistente.
      }
      try {
        execSync(`docker rm "${containerName}"`, { stdio: "pipe" });
      } catch {
        // Contenedor previo inexistente.
      }

      const previous = await store.get(projectId);
      if (previous?.port) {
        await releasePort(connection, Number(previous.port));
      }

      const host = appHost(appName);
      const deployNetwork = resolveDeployNetwork();
      const upstream = `${containerName}:${CONTAINER_INTERNAL_PORT}`;

      try {
        await execAsync("docker network create mi-paas_default");
      } catch {
        // La red ya existe, ignorar
      }
      if (deployNetwork !== "mi-paas_default") {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(deployNetwork)) {
          throw new Error(`Nombre de red Docker inválido: ${deployNetwork}`);
        }
        try {
          await execAsync(`docker network create "${deployNetwork}"`);
        } catch {
          // La red ya existe, ignorar
        }
      }
      if (!isWorker) {
        await ensureCaddyOnNetwork(deployNetwork);
      }

      const runtimeEnv = selectEnv(variables, deploymentType);
      for (const variable of plainVariables) {
        runtimeEnv[variable.key] = variable.value;
      }
      if (!runtimeEnv.DATABASE_URL?.trim()) {
        runtimeEnv.DATABASE_URL = DEFAULT_RUNTIME_DATABASE_URL;
      }
      if (pythonRuntime) {
        runtimeEnv.DATABASE_URL = withoutPrismaSchemaParam(runtimeEnv.DATABASE_URL);
      }
      runtimeEnv.DATABASE_URL = sanitizeDatabaseUrl(runtimeEnv.DATABASE_URL);
      const databaseTarget = describeDatabaseTarget(runtimeEnv.DATABASE_URL);
      await note(
        `Database target: user=${databaseTarget.user}, host=${databaseTarget.host}, port=${databaseTarget.port}`,
      );
      if (databaseTarget.user === "postgresql") {
        throw new Error(
          "Fallo de validación: El usuario de DATABASE_URL es 'postgresql'. Verifique las credenciales de Neon en el panel.",
        );
      }
      if (!isWorker) {
        runtimeEnv.PORT = String(CONTAINER_INTERNAL_PORT);
      }
      runtimeEnv.NODE_ENV = "production";
      const envFlags = dockerEnvFlags(runtimeEnv);

      const limits = deployResourceLimits(
        {
          ...runtimeEnv,
          ...(job.data.env ?? {}),
        },
        { memoryLimit, cpuLimit },
      );
      await note(
        `Levantando contenedor ${containerName} en red ${deployNetwork} (sin -p; upstream ${upstream}; ${limits.memory} / ${limits.cpus} CPU)...`,
      );
      await note(
        `Inyectando env: ${Object.keys(runtimeEnv).sort().join(", ")}`,
      );
      let containerId: string;
      try {
        containerId = execSync(
          `docker run -d --name "${containerName}" --label paas.app="${appName}" --network "${deployNetwork}" --memory=${limits.memory} --memory-swap=${limits.memory} --cpus=${limits.cpus} --pids-limit=100 --restart=always ${envFlags} "${appName}"`,
          { stdio: "pipe" },
        )
          .toString()
          .trim();
      } catch (runError) {
        throw new Error(redactEnvValues(redactSecrets(commandError(runError)), runtimeEnv));
      }

      const stopAppLogs = followContainerLogs(containerId, note);
      let paused: string[] = [];
      let health: { ok: true } | { ok: false; reason: string };
      try {
        paused = await pausePreviousContainers(appName, projectId, note);
        await note(
          isWorker
            ? "Health check: docker inspect Running cada 1.5s durante hasta 15s, sin reinicios..."
            : `Health check: HTTP HEAD :${CONTAINER_INTERNAL_PORT} cada ${HEALTH_INTERVAL_MS / 1000}s durante hasta ${HEALTH_TIMEOUT_MS / 1000}s, sin reinicios...`,
        );
        health = await checkContainerHealth(
          containerId,
          deployNetwork,
          note,
          isWorker ? "process" : "http",
        );
      } finally {
        stopAppLogs();
      }
      if (!health.ok) {
        const dockerLogs = readDockerLogs(containerId);
        const failure = [
          health.reason,
          dockerLogs ? `--- docker logs ---\n${dockerLogs}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        await resumeContainers(paused, note);
        discardNewContainer(containerName);
        await note(
          `${failure}\nContenedor nuevo ${containerName} eliminado. ${
            paused.length > 0
              ? "El contenedor anterior fue reanudado."
              : "No había un contenedor anterior que reanudar."
          }`,
        );
        await finishDeployRecord(projectId, {
          status: "failed",
          image: appName,
          port: String(CONTAINER_INTERNAL_PORT),
          host,
        });
        await syncDeployment(deploymentId, {
          status: "failed",
          port: CONTAINER_INTERNAL_PORT,
          containerId,
          buildLogs: lines.join("\n"),
        });
        throw new Error(health.reason);
      }

      let routed = isWorker;
      if (isWorker) {
        await note(`Worker ${containerName} en marcha. Sin ruta de Caddy.`);
        try {
          await retirePreviousDeploys(appName, projectId, note, paused);
        } catch (error) {
          await note(
            `No se pudieron retirar los contenedores anteriores: ${commandError(error)}`,
          );
        }
      } else {
        try {
          const domainHost = deploymentType === "PRODUCTION" ? customDomain : null;
          await caddy.upsertRoute(projectId, host, upstream, domainHost);
          routed = true;
          await note(
            domainHost
              ? `Contenedor levantado y enrutado vía ${upstream} (${host}, ${domainHost}).`
              : `Contenedor levantado y enrutado vía ${upstream}.`,
          );
        } catch (caddyError) {
          const caddyMessage = commandError(caddyError);
          await note(
            `Contenedor saludable (${containerName}), pero el enrutamiento de Caddy falló: ${caddyMessage}`,
          );
        }

        if (routed) {
          try {
            await retirePreviousDeploys(appName, projectId, note, paused);
          } catch (error) {
            await note(
              `No se pudieron retirar los contenedores anteriores: ${commandError(error)}`,
            );
          }
        } else {
          await resumeContainers(paused, note);
        }
      }

      await recordDuration();
      await finishDeployRecord(projectId, {
        status: "running",
        image: appName,
        port: String(CONTAINER_INTERNAL_PORT),
        host,
      });
      await markDeploymentRunning(deploymentId, {
        port: CONTAINER_INTERNAL_PORT,
        url: appPublicUrl(appName),
        containerId,
        buildLogs: lines.join("\n"),
      });
      if (!routed) {
        console.warn(
          `Deploy ${projectId}: contenedor ${containerId} (${upstream}) sin ruta Caddy`,
        );
      }
    } catch (error) {
      const message = redactSecrets(commandError(error));
      console.error(message);
      lines.push(message);
      await logs.append(projectId, message);
      await finishDeployRecord(projectId, { status: "failed" });
      await recordDuration();
      await syncDeployment(deploymentId, {
        status: "failed",
        buildLogs: lines.join("\n"),
      });
      throw error;
    } finally {
      if (cloned) {
        fs.rmSync(repoDir, { recursive: true, force: true });
        console.log(`Carpeta temporal eliminada: ${repoDir}`);
      }
    }
  },
  { connection, concurrency, lockDuration: LOCK_DURATION_MS },
);

worker.on("completed", (job) => {
  console.log(`Deploy job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(
    `Deploy job ${job?.id ?? "unknown"} failed: ${redactSecrets(error.message)}`,
  );
});

worker.on("error", (error) => {
  console.error(`Deploy worker error: ${redactSecrets(error.message)}`);
});

console.log(
  `Deploy worker listening with concurrency ${concurrency} and lockDuration ${LOCK_DURATION_MS}ms`,
);

function repoDirectory(jobId: string | undefined): string {
  if (!jobId || !/^[a-z0-9_-]+$/i.test(jobId)) {
    throw new Error("jobId inválido para la carpeta temporal");
  }
  return path.resolve(os.tmpdir(), "deployments", jobId);
}

const APP_CONTAINER_NAME = /^paas-([a-f0-9]{16})$/;

function followContainerLogs(
  containerId: string,
  note: (message: string) => Promise<void>,
): () => void {
  if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
    return () => undefined;
  }
  const child = spawn("docker", ["logs", "-f", containerId], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffer = "";
  const pending: string[] = [];
  let writing = false;

  const flush = () => {
    if (writing) return;
    writing = true;
    const drain = async () => {
      while (pending.length > 0) {
        const line = pending.shift();
        if (!line) continue;
        await note(redactLogLine(line));
      }
      writing = false;
      if (pending.length > 0) flush();
    };
    void drain();
  };

  const push = (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (line) pending.push(line);
    }
    flush();
  };

  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  return () => {
    child.kill();
  };
}

function redactLogLine(line: string): string {
  return line.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, (url) =>
    url.includes("@") ? "[url-redacted]" : url,
  );
}

function discardNewContainer(name: string): void {
  if (!APP_CONTAINER_NAME.test(name)) {
    return;
  }
  try {
    execSync(`docker rm -f "${name}"`, { stdio: "pipe" });
  } catch {
    // El contenedor nuevo ya no está.
  }
}

async function pausePreviousContainers(
  appName: string,
  currentProjectId: string,
  note: (message: string) => Promise<void>,
): Promise<string[]> {
  const paused: string[] = [];
  for (const name of listPreviousContainers(appName, currentProjectId)) {
    if (!APP_CONTAINER_NAME.test(name)) {
      continue;
    }
    try {
      execSync(`docker stop "${name}"`, { stdio: "pipe" });
      paused.push(name);
      await note(`Contenedor anterior ${name} pausado`);
    } catch (error) {
      await note(`No se pudo pausar ${name}: ${commandError(error)}`);
    }
  }
  return paused;
}

async function resumeContainers(
  names: string[],
  note: (message: string) => Promise<void>,
): Promise<void> {
  for (const name of names) {
    if (!APP_CONTAINER_NAME.test(name)) {
      continue;
    }
    try {
      execSync(`docker start "${name}"`, { stdio: "pipe" });
      await note(`Contenedor anterior ${name} reanudado`);
    } catch (error) {
      await note(`No se pudo reanudar ${name}: ${commandError(error)}`);
    }
  }
}

async function retirePreviousDeploys(
  appName: string,
  currentProjectId: string,
  note: (message: string) => Promise<void>,
  paused: string[] = [],
): Promise<void> {
  const names = [
    ...new Set([...listPreviousContainers(appName, currentProjectId), ...paused]),
  ];
  for (const name of names) {
    const match = APP_CONTAINER_NAME.exec(name);
    if (!match) {
      continue;
    }
    const previousId = match[1];
    try {
      execSync(`docker stop "${name}"`, { stdio: "pipe" });
    } catch {
      // El contenedor dejó de estar en marcha entre el listado y el stop.
    }
    try {
      execSync(`docker rm -f "${name}"`, { stdio: "pipe" });
    } catch (error) {
      await note(`No se pudo eliminar ${name}: ${commandError(error)}`);
      continue;
    }
    try {
      await caddy.deleteRoute(previousId);
    } catch (error) {
      await note(
        `No se pudo quitar la ruta anterior de ${name}: ${commandError(error)}`,
      );
    }
    await store.update(previousId, { status: "replaced" });
    await note(`Contenedor anterior ${name} detenido y eliminado`);
  }

  await caddy.ensureCatchAll();
}

function listedContainerNames(status: string): string[] {
  try {
    return execSync(`docker ps --filter status=${status} --format "{{.Names}}"`, {
      stdio: "pipe",
      encoding: "utf8",
    })
      .split(/\s+/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function listPreviousContainers(appName: string, currentProjectId: string): string[] {
  const listed = [
    ...new Set([
      ...listedContainerNames("running"),
      ...listedContainerNames("restarting"),
    ]),
  ];

  const currentName = `paas-${currentProjectId}`;
  const names: string[] = [];
  for (const name of listed) {
    if (name === currentName || !APP_CONTAINER_NAME.test(name)) {
      continue;
    }
    let inspected = "";
    try {
      inspected = execSync(
        `docker inspect -f '{{.Config.Image}}|{{index .Config.Labels "paas.app"}}' "${name}"`,
        { stdio: "pipe", encoding: "utf8" },
      ).trim();
    } catch {
      continue;
    }
    const [image = "", label = ""] = inspected.split("|");
    const imageName = image.split(":")[0];
    if (label === appName || image === appName || imageName === appName) {
      names.push(name);
    }
  }
  return names;
}

function dockerTag(image: string, projectName: string): string {
  if (/^[a-z0-9][a-z0-9._-]{0,127}$/.test(image)) {
    return image;
  }
  return normalizeImageName(projectName);
}

async function releasePort(redis: Redis, port: number): Promise<void> {
  if (!Number.isInteger(port) || port <= 0) {
    return;
  }
  await redis.del(`${PORT_KEY_PREFIX}${port}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dockerEnvFlags(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return false;
      }
      return typeof value === "string" && !value.includes("\n") && !value.includes("\r");
    })
    .map(([key, value]) => {
      const escaped = value.replace(/'/g, `'\\''`);
      return `-e '${key}=${escaped}'`;
    })
    .join(" ");
}

function resolveDeployNetwork(): string {
  const fromEnv = process.env.DEPLOY_NETWORK?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (dockerNetworkExists("paas")) {
    return "paas";
  }

  for (const container of ["mi-paas-caddy-1", "caddy", "paas-caddy-1"]) {
    try {
      const networks = execSync(
        `docker inspect -f "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}" "${container}"`,
        { stdio: "pipe", encoding: "utf8" },
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (networks[0]) {
        return networks[0];
      }
    } catch {
      // Probar el siguiente nombre de contenedor Caddy.
    }
  }

  return "mi-paas_default";
}

function dockerNetworkExists(name: string): boolean {
  try {
    execSync(`docker network inspect "${name}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function ensureCaddyOnNetwork(network: string): Promise<void> {
  for (const container of ["mi-paas-caddy-1", "caddy", "paas-caddy-1"]) {
    try {
      await execAsync(`docker network connect "${network}" "${container}"`);
      return;
    } catch {
      // Ya conectado o nombre incorrecto; probar el siguiente.
    }
  }
}

function sanitizeDatabaseUrl(value: string): string {
  let url = value.trim();
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }
  while (
    url.startsWith("postgresql://postgresql://") ||
    url.startsWith("postgres://postgresql://")
  ) {
    url = url
      .replace("postgresql://postgresql://", "postgresql://")
      .replace("postgres://postgresql://", "postgresql://");
  }
  return url;
}

function describeDatabaseTarget(value: string): { user: string; host: string; port: string } {
  try {
    const parsed = new URL(value);
    return {
      user: parsed.username,
      host: parsed.hostname,
      port: parsed.port || "5432",
    };
  } catch {
    const match = value.match(
      /^postgres(?:ql)?:\/\/(?:([^:@/?#]+)(?::[^@/?#]*)?@)?([^:/?#]+)(?::(\d+))?/i,
    );
    return {
      user: match?.[1] ?? "",
      host: match?.[2] ?? "",
      port: match?.[3] || "5432",
    };
  }
}

function withoutPrismaSchemaParam(value: string): string {
  const [withoutHash, ...hashParts] = value.split("#");
  const queryAt = withoutHash.indexOf("?");
  if (queryAt === -1) {
    return value;
  }
  const base = withoutHash.slice(0, queryAt);
  const kept = withoutHash
    .slice(queryAt + 1)
    .split("&")
    .filter((part) => part.length > 0 && !/^schema=/i.test(part));
  const next = kept.length > 0 ? `${base}?${kept.join("&")}` : base;
  return hashParts.length > 0 ? `${next}#${hashParts.join("#")}` : next;
}

function readDockerLogs(containerId: string): string {
  try {
    return execSync(`docker logs --tail 80 "${containerId}" 2>&1`, {
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
  } catch (error) {
    if (error && typeof error === "object") {
      const stdout = "stdout" in error ? String(error.stdout ?? "") : "";
      const stderr = "stderr" in error ? String(error.stderr ?? "") : "";
      return [stdout, stderr].filter(Boolean).join("\n").trim();
    }
    return "";
  }
}

function containerState(containerId: string): {
  running: boolean;
  status: string;
  restartCount: number;
  oomKilled: boolean;
} {
  try {
    const raw = execSync(
      `docker inspect --format='{{.State.Running}}|{{.State.Status}}|{{.RestartCount}}|{{.State.OOMKilled}}' "${containerId}"`,
      { stdio: "pipe", encoding: "utf8" },
    ).trim();
    const [runningRaw = "false", status = "missing", restarts = "0", oom = "false"] =
      raw.split("|");
    return {
      running: runningRaw === "true",
      status,
      restartCount: Number(restarts) || 0,
      oomKilled: oom === "true",
    };
  } catch {
    return { running: false, status: "missing", restartCount: 0, oomKilled: false };
  }
}

function containerIp(containerId: string, network: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(network)) {
    return "";
  }
  try {
    const raw = execSync(
      `docker inspect --format '{{json .NetworkSettings.Networks}}' "${containerId}"`,
      { stdio: "pipe", encoding: "utf8" },
    ).trim();
    const networks = JSON.parse(raw) as Record<string, { IPAddress?: string }>;
    return networks[network]?.IPAddress?.trim() ?? "";
  } catch {
    return "";
  }
}

async function probeHttp(ip: string, port: number): Promise<number | null> {
  try {
    const response = await fetch(`http://${ip}:${port}/`, {
      method: "HEAD",
      signal: AbortSignal.timeout(2_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

async function checkProcessHealth(
  containerId: string,
  note?: (message: string) => Promise<void>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + WORKER_HEALTH_TIMEOUT_MS;
  let attempt = 0;
  let last = containerState(containerId);

  while (Date.now() <= deadline) {
    attempt += 1;
    last = containerState(containerId);
    const failed = healthFailure(last);
    if (failed) {
      return { ok: false, reason: failed };
    }
    if (note) {
      await note(
        `Health check intento ${attempt}: Running=${last.running} (estado "${last.status}", RestartCount=${last.restartCount}).`,
      );
    }
    if (Date.now() + HEALTH_INTERVAL_MS > deadline) {
      break;
    }
    await sleep(HEALTH_INTERVAL_MS);
  }

  last = containerState(containerId);
  const failed = healthFailure(last);
  if (failed) {
    return { ok: false, reason: failed };
  }
  if (last.running && last.status === "running" && last.restartCount === 0) {
    if (note) {
      await note("Health check OK: sigue running tras 15s, sin reinicios.");
    }
    return { ok: true };
  }
  return {
    ok: false,
    reason: `Health check falló tras 15s: estado "${last.status}", RestartCount=${last.restartCount}.`,
  };
}

async function checkContainerHealth(
  containerId: string,
  network: string,
  note?: (message: string) => Promise<void>,
  mode: "http" | "process" = "http",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (mode === "process") {
    return checkProcessHealth(containerId, note);
  }
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let attempt = 0;
  let last = containerState(containerId);

  while (Date.now() <= deadline) {
    attempt += 1;
    last = containerState(containerId);
    const failed = healthFailure(last);
    if (failed) {
      return { ok: false, reason: failed };
    }
    const ip = containerIp(containerId, network);
    const status = ip ? await probeHttp(ip, CONTAINER_INTERNAL_PORT) : null;
    if (note) {
      await note(
        status === null
          ? `Health check intento ${attempt}: Running=${last.running} (estado "${last.status}", RestartCount=${last.restartCount}), HTTP aún sin respuesta.`
          : `Health check intento ${attempt}: HTTP ${status}, RestartCount=${last.restartCount}.`,
      );
    }
    if (
      status !== null &&
      last.running &&
      last.status === "running" &&
      last.restartCount === 0
    ) {
      if (note) {
        await note(`Health check OK: HTTP ${status} y RestartCount=0.`);
      }
      return { ok: true };
    }
    if (Date.now() + HEALTH_INTERVAL_MS > deadline) {
      break;
    }
    await sleep(HEALTH_INTERVAL_MS);
  }

  last = containerState(containerId);
  const failed = healthFailure(last);
  if (failed) {
    return { ok: false, reason: failed };
  }
  return {
    ok: false,
    reason: `Health check falló tras ${HEALTH_TIMEOUT_MS / 1000}s: Uvicorn no respondió HTTP en el puerto ${CONTAINER_INTERNAL_PORT} (estado "${last.status}", RestartCount=${last.restartCount}).`,
  };
}

function healthFailure(state: {
  status: string;
  restartCount: number;
  oomKilled: boolean;
}): string | null {
  if (state.oomKilled) {
    return `Health check falló: OOMKilled (estado "${state.status}").`;
  }
  if (state.restartCount > 0 || state.status === "restarting") {
    return `Health check falló: el contenedor reinició (estado "${state.status}", RestartCount=${state.restartCount}).`;
  }
  if (state.status === "exited" || state.status === "dead" || state.status === "missing") {
    return `Health check falló: el contenedor pasó a estado "${state.status}" (Running=false).`;
  }
  return null;
}

function commandError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Deploy failed";
  if (error && typeof error === "object") {
    const stderr =
      "stderr" in error
        ? String((error as { stderr?: Buffer | string }).stderr ?? "").trim()
        : "";
    const stdout =
      "stdout" in error
        ? String((error as { stdout?: Buffer | string }).stdout ?? "").trim()
        : "";
    const detail = [stderr, stdout].filter(Boolean).join("\n");
    return detail ? `${message}\n${detail}` : message;
  }
  return message;
}
