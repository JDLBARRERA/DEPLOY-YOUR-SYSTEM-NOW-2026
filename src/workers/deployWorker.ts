import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
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
const concurrency = Number(process.env.DEPLOY_CONCURRENCY ?? 2);

const DEFAULT_DOCKERFILE = `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`;

const worker = new Worker<DeployJobData>(
  DEPLOY_QUEUE_NAME,
  async (job) => {
    const { projectId, repoUrl, projectName, deploymentId } = job.data;
    const appName = dockerTag(job.data.image, projectName);
    const lines: string[] = [];
    const repoDir = repoDirectory(job.id);
    let cloned = false;

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
        execSync(`docker stop "${appName}"`, { stdio: "pipe" });
      } catch {
        // Contenedor previo inexistente.
      }
      try {
        execSync(`docker rm "${appName}"`, { stdio: "pipe" });
      } catch {
        // Contenedor previo inexistente.
      }

      const containerPort = readContainerPort(dockerfilePath);
      const puertoLibre = await findFreePort(8000);
      const host = appHost(appName);

      await note(`Levantando contenedor en el puerto ${puertoLibre}...`);
      const containerId = execSync(
        `docker run -d --name "${appName}" -p ${puertoLibre}:${containerPort} -e PORT=${containerPort} "${appName}"`,
        { stdio: "pipe" },
      )
        .toString()
        .trim();

      await caddy.upsertRoute(projectId, host, puertoLibre);
      await note(`Contenedor levantado y enrutado en el puerto ${puertoLibre}.`);

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
    } catch (error) {
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

function findFreePort(from = 8000): Promise<number> {
  const max = from + 999;
  const tryPort = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      if (port > max) {
        reject(new Error(`No hay puerto libre entre ${from} y ${max}`));
        return;
      }
      const server = net.createServer();
      server.unref();
      server.once("error", () => {
        void tryPort(port + 1).then(resolve, reject);
      });
      server.listen(port, "0.0.0.0", () => {
        server.close((error) => {
          if (error) {
            void tryPort(port + 1).then(resolve, reject);
            return;
          }
          resolve(port);
        });
      });
    });
  return tryPort(from);
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
