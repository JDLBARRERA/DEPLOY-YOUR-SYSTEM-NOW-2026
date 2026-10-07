import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Redis } from "ioredis";
import { Worker } from "bullmq";
import { appHost, appPublicUrl } from "../services/appHost.js";
import { CaddyClient } from "../services/CaddyClient.js";
import { DeploymentStore } from "../services/DeploymentStore.js";
import { LogBus } from "../services/LogBus.js";
import {
  assertPublicGitHubRepo,
  normalizeImageName,
} from "../services/DeployEngine.js";
import { DEPLOY_QUEUE_NAME, type DeployJobData } from "../queues/deployQueue.js";
import { createRedis } from "../redis.js";
import { syncDeployment } from "../services/syncDeployment.js";

const connection = createRedis();
const store = new DeploymentStore(connection);
const logs = new LogBus(connection);
const caddy = new CaddyClient();
const concurrency = Number(process.env.DEPLOY_CONCURRENCY ?? 5);
const HEALTH_WAIT_MS = 3000;

const PORT_KEY_PREFIX = "deploy:port:";
const PORT_TTL_SECONDS = 60 * 60 * 24;

const DEFAULT_DOCKERFILE = `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build || true
EXPOSE 8000
CMD ["npm", "start"]
`;

const worker = new Worker<DeployJobData>(
  DEPLOY_QUEUE_NAME,
  async (job) => {
    const { projectId, repoUrl, projectName, deploymentId } = job.data;
    const appName = dockerTag(job.data.image, projectName);
    const containerName = `paas-${projectId}`;
    const lines: string[] = [];
    const repoDir = repoDirectory(job.id);
    let cloned = false;
    let reservedPort: number | null = null;

    const note = async (message: string) => {
      console.log(message);
      lines.push(message);
      await logs.append(projectId, message);
    };

    await store.update(projectId, { status: "building" });
    await syncDeployment(deploymentId, { status: "building" });
    await note(`Construyendo ${appName}. Estado: building`);

    try {
      assertPublicGitHubRepo(repoUrl);

      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.mkdirSync(repoDir, { recursive: true });

      await note("Clonando repositorio...");
      execSync(`git clone "${repoUrl}" .`, { cwd: repoDir, stdio: "pipe" });
      cloned = true;

      console.log("Directorio del repo:", repoDir);
      const dockerfilePath = path.join(repoDir, "Dockerfile");
      if (!fs.existsSync(dockerfilePath)) {
        fs.writeFileSync(dockerfilePath, DEFAULT_DOCKERFILE);
        console.log("Dockerfile autogenerado en:", dockerfilePath);
        await logs.append(projectId, `Dockerfile autogenerado en: ${dockerfilePath}`);
        lines.push(`Dockerfile autogenerado en: ${dockerfilePath}`);
      }

      await note("Construyendo imagen...");
      execSync(`docker build -t "${appName}" .`, { cwd: repoDir, stdio: "pipe" });

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

      const containerPort = readContainerPort(dockerfilePath);
      const puertoLibre = await reserveFreePort(connection, 8000);
      reservedPort = puertoLibre;
      const host = appHost(appName);
      const deployNetwork = resolveDeployNetwork();

      await note(
        `Levantando contenedor en el puerto ${puertoLibre} (red ${deployNetwork})...`,
      );
      const containerId = execSync(
        `docker run -d --name "${containerName}" --network "${deployNetwork}" -p ${puertoLibre}:${containerPort} -e PORT=${containerPort} "${appName}"`,
        { stdio: "pipe" },
      )
        .toString()
        .trim();

      await note(`Esperando ${HEALTH_WAIT_MS / 1000}s para health check...`);
      await sleep(HEALTH_WAIT_MS);

      const health = await checkContainerHealth(containerId, puertoLibre);
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
          port: String(puertoLibre),
          host,
        });
        await syncDeployment(deploymentId, {
          status: "failed",
          port: puertoLibre,
          containerId,
          buildLogs: lines.join("\n"),
        });
        await releasePort(connection, puertoLibre);
        reservedPort = null;
        throw new Error(health.reason);
      }

      await note(`Health check OK (Running=true) en el puerto ${puertoLibre}.`);

      let routed = false;
      try {
        await caddy.upsertRoute(projectId, host, puertoLibre);
        routed = true;
        await note(`Contenedor levantado y enrutado en el puerto ${puertoLibre}.`);
      } catch (caddyError) {
        const caddyMessage = commandError(caddyError);
        await note(
          `Contenedor saludable en el puerto ${puertoLibre}, pero el enrutamiento de Caddy falló: ${caddyMessage}`,
        );
      }

      await store.update(projectId, {
        status: "running",
        image: appName,
        port: String(puertoLibre),
        host,
      });
      await syncDeployment(deploymentId, {
        status: "running",
        port: puertoLibre,
        url: appPublicUrl(appName),
        containerId,
        buildLogs: lines.join("\n"),
      });
      if (!routed) {
        console.warn(
          `Deploy ${projectId}: contenedor ${containerId} en :${puertoLibre} sin ruta Caddy`,
        );
      }
      reservedPort = null;
    } catch (error) {
      if (reservedPort !== null) {
        await releasePort(connection, reservedPort);
      }
      const message = commandError(error);
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
  console.error(`Deploy job ${job?.id ?? "unknown"} failed: ${error.message}`);
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

function readContainerPort(dockerfilePath: string): number {
  try {
    const content = fs.readFileSync(dockerfilePath, "utf8");
    const match = content.match(/^\s*EXPOSE\s+(\d+)/im);
    if (match?.[1]) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        return port;
      }
    }
  } catch {
    // Fallback abajo.
  }
  return 3000;
}

async function reserveFreePort(redis: Redis, from = 8000): Promise<number> {
  const max = from + 999;
  for (let port = from; port <= max; port++) {
    const locked = await redis.set(
      `${PORT_KEY_PREFIX}${port}`,
      "1",
      "EX",
      PORT_TTL_SECONDS,
      "NX",
    );
    if (locked !== "OK") {
      continue;
    }
    if (!(await canBindPort(port))) {
      await redis.del(`${PORT_KEY_PREFIX}${port}`);
      continue;
    }
    return port;
  }
  throw new Error(`No hay puerto libre entre ${from} y ${max}`);
}

async function releasePort(redis: Redis, port: number): Promise<void> {
  if (!Number.isInteger(port) || port <= 0) {
    return;
  }
  await redis.del(`${PORT_KEY_PREFIX}${port}`);
}

function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => {
      server.close((error) => resolve(!error));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function httpReachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        timeout: 2000,
      },
      (response) => {
        response.resume();
        resolve(true);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function checkContainerHealth(
  containerId: string,
  hostPort: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const state = containerRunning(containerId);
  if (!state.running) {
    return {
      ok: false,
      reason: `Health check falló: docker inspect Running=false (estado "${state.status}").`,
    };
  }

  const reachable = await httpReachable(hostPort);
  if (!reachable) {
    return {
      ok: false,
      reason: `Health check falló: el contenedor corre pero no responde HTTP en el puerto ${hostPort}.`,
    };
  }

  return { ok: true };
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
