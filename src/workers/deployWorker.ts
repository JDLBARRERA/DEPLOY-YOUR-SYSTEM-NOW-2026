import "dotenv/config";
import { exec, execSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Worker } from "bullmq";
import { DeploymentStore } from "../services/DeploymentStore.js";
import { LogBus } from "../services/LogBus.js";
import {
  assertPublicGitHubRepo,
  normalizeImageName,
} from "../services/DeployEngine.js";
import { DEPLOY_QUEUE_NAME, type DeployJobData } from "../queues/deployQueue.js";
import { createRedis } from "../redis.js";
import { syncDeployment } from "../services/syncDeployment.js";

const execAsync = promisify(exec);
const connection = createRedis();
const store = new DeploymentStore(connection);
const logs = new LogBus(connection);
const concurrency = Number(process.env.DEPLOY_CONCURRENCY ?? 2);

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
      await rm(repoDir, { recursive: true, force: true });
      await mkdir(path.dirname(repoDir), { recursive: true });

      await note("Clonando repositorio...");
      await execAsync(`git clone ${shellArg(repoUrl)} ${shellArg(repoDir)}`);
      cloned = true;

      console.log("Directorio del repo:", repoDir);
      const dockerfilePath = path.join(repoDir, "Dockerfile");
      console.log("¿Existe Dockerfile?:", fs.existsSync(dockerfilePath));

      if (!fs.existsSync(dockerfilePath)) {
        fs.writeFileSync(dockerfilePath, dockerfileFor(repoDir), "utf8");
        console.log("Dockerfile autogenerado exitosamente en:", dockerfilePath);
        await logs.append(projectId, `Dockerfile autogenerado exitosamente en: ${dockerfilePath}`);
        lines.push(`Dockerfile autogenerado exitosamente en: ${dockerfilePath}`);
      }

      await note("Construyendo imagen...");
      execSync(`docker build -t "${appName}" .`, { cwd: repoDir, stdio: "pipe" });

      await note("Imagen construida. Estado: running");
      await store.update(projectId, { status: "running", image: appName });
      await syncDeployment(deploymentId, {
        status: "running",
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
        await rm(repoDir, { recursive: true, force: true });
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

const NODE_DOCKERFILE = `FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`;

const STATIC_DOCKERFILE = `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
`;

function dockerfileFor(repoDir: string): string {
  const html = fs.existsSync(path.join(repoDir, "index.html"));
  const nodeApp = fs.existsSync(path.join(repoDir, "package.json"));
  return html && !nodeApp ? STATIC_DOCKERFILE : NODE_DOCKERFILE;
}

function shellArg(value: string): string {
  if (/[\r\n"$`;&|<>]/.test(value)) {
    throw new Error("argumento de comando no permitido");
  }
  return `"${value}"`;
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
