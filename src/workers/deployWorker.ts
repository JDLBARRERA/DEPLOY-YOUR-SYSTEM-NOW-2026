import "dotenv/config";
import { exec } from "node:child_process";
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
    const imageTag = dockerTag(job.data.image, projectName);
    const lines: string[] = [];
    let workdir = "";

    const note = async (message: string) => {
      console.log(message);
      lines.push(message);
      await logs.append(projectId, message);
    };

    await store.update(projectId, { status: "building" });
    await syncDeployment(deploymentId, { status: "building" });
    await note(`Construyendo ${imageTag}. Estado: building`);

    try {
      workdir = deploymentDir(projectId);
      assertPublicGitHubRepo(repoUrl);
      await rm(workdir, { recursive: true, force: true });
      await mkdir(path.dirname(workdir), { recursive: true });

      await note("Clonando repositorio...");
      await execAsync(`git clone ${shellArg(repoUrl)} ${shellArg(workdir)}`);

      await note("Construyendo imagen...");
      await execAsync(`docker build -t ${shellArg(imageTag)} .`, { cwd: workdir });

      await note("Imagen construida. Estado: running");
      await store.update(projectId, { status: "running", image: imageTag });
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
      if (workdir) {
        await rm(workdir, { recursive: true, force: true });
        console.log(`Carpeta temporal eliminada: ${workdir}`);
      }
    }
  },
  { connection, concurrency },
);

worker.on("failed", (job, error) => {
  console.error(`Deploy job ${job?.id ?? "unknown"} failed: ${error.message}`);
});

console.log(`Deploy worker listening with concurrency ${concurrency}`);

function deploymentDir(projectId: string): string {
  if (!/^[a-z0-9]+$/i.test(projectId)) {
    throw new Error("projectId inválido para la carpeta temporal");
  }
  return path.join(os.tmpdir(), "deployments", projectId);
}

function dockerTag(image: string, projectName: string): string {
  if (/^[a-z0-9][a-z0-9._-]{0,127}$/.test(image)) {
    return image;
  }
  return normalizeImageName(projectName);
}

function shellArg(value: string): string {
  if (/[\r\n"$`;&|<>]/.test(value)) {
    throw new Error("argumento de comando no permitido");
  }
  return `"${value}"`;
}

function commandError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Deploy failed";
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
    return stderr ? `${message}\n${stderr}` : message;
  }
  return message;
}
