import "dotenv/config";
import { exec, execSync } from "node:child_process";
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
} from "../services/projectEnv.js";
import { createRedis } from "../redis.js";
import { syncDeployment } from "../services/syncDeployment.js";

const execAsync = promisify(exec);
const connection = createRedis();
const store = new DeploymentStore(connection);
const logs = new LogBus(connection);
const caddy = new CaddyClient();
const concurrency = Number(process.env.DEPLOY_CONCURRENCY ?? 5);
const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_INTERVAL_MS = 2_000;
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
    let cloned = false;

    const note = async (message: string) => {
      console.log(message);
      lines.push(message);
      await logs.append(projectId, message);
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

      const { variables, deploymentType, memoryLimit, cpuLimit, githubToken } =
        await variablesForDeployment(deploymentId);

      await note(`Clonando repositorio (rama ${branch})...`);
      const cloneUrl = githubCloneUrl(repoUrl, githubToken);
      execSync(`git clone -b "${branch}" --single-branch "${cloneUrl}" .`, {
        cwd: repoDir,
        stdio: "pipe",
      });
      cloned = true;

      if (commitHash) {
        await note(`Checkout commit ${commitHash}...`);
        execSync(`git checkout "${commitHash}"`, {
          cwd: repoDir,
          stdio: "pipe",
        });
      }

      const head = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
      await syncDeployment(deploymentId, { commitHash: head, branch });

      console.log("Directorio del repo:", repoDir);
      const dockerfilePath = path.join(repoDir, "Dockerfile");
      if (!fs.existsSync(dockerfilePath)) {
        fs.writeFileSync(dockerfilePath, DEFAULT_DOCKERFILE);
        console.log("Dockerfile autogenerado en:", dockerfilePath);
        await logs.append(projectId, `Dockerfile autogenerado en: ${dockerfilePath}`);
        lines.push(`Dockerfile autogenerado en: ${dockerfilePath}`);
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
        execSync(buildCmd, {
          cwd: repoDir,
          stdio: "pipe",
          encoding: "utf8",
        });
      } catch (buildError) {
        const detail = commandError(buildError);
        await note(`docker build falló (incluye npm run build):\n${detail}`);
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
      await ensureCaddyOnNetwork(deployNetwork);

      const runtimeEnv = selectEnv(variables, deploymentType);
      if (!runtimeEnv.DATABASE_URL?.trim()) {
        runtimeEnv.DATABASE_URL = DEFAULT_RUNTIME_DATABASE_URL;
      }
      runtimeEnv.PORT = String(CONTAINER_INTERNAL_PORT);
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
      const containerId = execSync(
        `docker run -d --name "${containerName}" --network "${deployNetwork}" --memory=${limits.memory} --memory-swap=${limits.memory} --cpus=${limits.cpus} ${envFlags} "${appName}"`,
        { stdio: "pipe" },
      )
        .toString()
        .trim();

      await note(
        `Health check: docker inspect Running cada ${HEALTH_INTERVAL_MS / 1000}s durante hasta ${HEALTH_TIMEOUT_MS / 1000}s...`,
      );
      const health = await checkContainerHealth(containerId, note);
      if (!health.ok) {
        const dockerLogs = readDockerLogs(containerId);
        const failure = [
          health.reason,
          dockerLogs ? `--- docker logs ---\n${dockerLogs}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        await note(failure);
        await store.update(projectId, {
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

      let routed = false;
      try {
        await caddy.upsertRoute(projectId, host, upstream);
        routed = true;
        await note(`Contenedor levantado y enrutado vía ${upstream}.`);
      } catch (caddyError) {
        const caddyMessage = commandError(caddyError);
        await note(
          `Contenedor saludable (${containerName}), pero el enrutamiento de Caddy falló: ${caddyMessage}`,
        );
      }

      await store.update(projectId, {
        status: "running",
        image: appName,
        port: String(CONTAINER_INTERNAL_PORT),
        host,
      });
      await syncDeployment(deploymentId, {
        status: "running",
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
      await store.update(projectId, { status: "failed" });
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
  { connection, concurrency },
);

worker.on("failed", (job, error) => {
  console.error(
    `Deploy job ${job?.id ?? "unknown"} failed: ${redactSecrets(error.message)}`,
  );
});

console.log(`Deploy worker listening with concurrency ${concurrency}`);

function repoDirectory(jobId: string | undefined): string {
  if (!jobId || !/^[a-z0-9_-]+$/i.test(jobId)) {
    throw new Error("jobId inválido para la carpeta temporal");
  }
  return path.resolve(os.tmpdir(), "deployments", jobId);
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

function readDockerLogs(containerId: string): string {
  try {
    return execSync(`docker logs --tail 80 "${containerId}"`, {
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

function containerRunning(containerId: string): { running: boolean; status: string } {
  try {
    const runningRaw = execSync(
      `docker inspect --format='{{.State.Running}}' "${containerId}"`,
      { stdio: "pipe", encoding: "utf8" },
    ).trim();
    const running = runningRaw === "true";
    let status = running ? "running" : "exited";
    try {
      status = execSync(
        `docker inspect --format='{{.State.Status}}' "${containerId}"`,
        { stdio: "pipe", encoding: "utf8" },
      ).trim();
    } catch {
      // Mantener status derivado de Running.
    }
    return { running, status };
  } catch {
    return { running: false, status: "missing" };
  }
}

async function checkContainerHealth(
  containerId: string,
  note?: (message: string) => Promise<void>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let attempt = 0;
  let lastStatus = "starting";

  while (Date.now() <= deadline) {
    attempt += 1;
    const state = containerRunning(containerId);
    lastStatus = state.status;

    if (state.running) {
      if (note) {
        await note(
          `Health check OK en intento ${attempt}: Running=true (estado "${state.status}").`,
        );
      }
      return { ok: true };
    }

    if (state.status === "exited" || state.status === "dead" || state.status === "missing") {
      return {
        ok: false,
        reason: `Health check falló: el contenedor pasó a estado "${state.status}" (Running=false).`,
      };
    }

    if (note) {
      await note(
        `Health check intento ${attempt}: Running=false (estado "${state.status}"); reintentando...`,
      );
    }

    if (Date.now() + HEALTH_INTERVAL_MS > deadline) {
      break;
    }
    await sleep(HEALTH_INTERVAL_MS);
  }

  return {
    ok: false,
    reason: `Health check falló tras ${HEALTH_TIMEOUT_MS / 1000}s: Running=false (último estado "${lastStatus}").`,
  };
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
