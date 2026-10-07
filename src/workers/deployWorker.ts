import "dotenv/config";
import { Worker } from "bullmq";
import { CaddyClient } from "../services/CaddyClient.js";
import { DeployEngine } from "../services/DeployEngine.js";
import { DeploymentStore } from "../services/DeploymentStore.js";
import { LogBus } from "../services/LogBus.js";
import { DEPLOY_QUEUE_NAME, type DeployJobData } from "../queues/deployQueue.js";
import { createRedis } from "../redis.js";
import { readEnvRecord, variablesForDeployment } from "../services/projectEnv.js";
import { syncDeployment } from "../services/syncDeployment.js";

const connection = createRedis();
const store = new DeploymentStore(connection);
const logs = new LogBus(connection);
const engine = new DeployEngine();
const caddy = new CaddyClient();
const concurrency = Number(process.env.DEPLOY_CONCURRENCY ?? 2);

const worker = new Worker<DeployJobData>(
  DEPLOY_QUEUE_NAME,
  async (job) => {
    const { projectId, repoUrl, projectName, image, deploymentId, branch } = job.data;
    const host = `${image}.localhost`;
    const url = `http://${host}`;
    const buildLines: string[] = [];

    await store.update(projectId, { status: "building" });
    await syncDeployment(deploymentId, { status: "building" });
    await logs.append(projectId, `Build started for ${image}`);
    buildLines.push(`Build started for ${image}`);

    let logChain = Promise.resolve();
    const onLog = (line: string) => {
      buildLines.push(line);
      logChain = logChain
        .then(() => logs.append(projectId, line))
        .then(() => undefined);
    };

    try {
      const scoped = await variablesForDeployment(deploymentId);
      const result = await engine.deploy({
        repoUrl,
        projectName,
        projectId,
        image,
        branch,
        variables: scoped.variables,
        deploymentType: scoped.deploymentType,
        env: readEnvRecord(job.data.env),
        onLog,
      });
      await logChain;

      await caddy.upsertRoute(projectId, host, result.port);
      const routed = `Routed ${url} to port ${result.port}`;
      await logs.append(projectId, routed);
      buildLines.push(routed);
      await engine.stopPrevious(image, result.containerId);
      await store.update(projectId, {
        status: result.status,
        port: String(result.port),
        host,
        image: result.image,
      });
      await syncDeployment(deploymentId, {
        status: result.status,
        containerId: result.containerId,
        port: result.port,
        url,
        commitHash: result.commitHash,
        buildLogs: buildLines.join("\n"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deploy failed";
      await logs.append(projectId, message);
      buildLines.push(message);
      await store.update(projectId, { status: "failed" });
      await syncDeployment(deploymentId, {
        status: "failed",
        buildLogs: buildLines.join("\n"),
      });
      throw error;
    }
  },
  { connection, concurrency },
);

worker.on("failed", (job, error) => {
  console.error(`Deploy job ${job?.id ?? "unknown"} failed: ${error.message}`);
});

console.log(`Deploy worker listening with concurrency ${concurrency}`);
