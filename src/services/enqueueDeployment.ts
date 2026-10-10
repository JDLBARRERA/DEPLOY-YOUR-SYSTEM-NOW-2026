import { randomBytes } from "node:crypto";
import type { Queue } from "bullmq";
import type { DeployJobData } from "../queues/deployQueue.js";
import type { DeploymentStore } from "./DeploymentStore.js";
import { appHost } from "./appHost.js";
import type { LogBus } from "./LogBus.js";

export class DeployInProgressError extends Error {
  constructor() {
    super("Ya hay un despliegue en curso");
    this.name = "DeployInProgressError";
  }
}

export interface EnqueueDeployInput {
  repoUrl: string;
  projectName: string;
  image: string;
  deploymentId?: string;
  branch?: string;
  commitHash?: string;
  clearCache?: boolean;
  env?: Record<string, string>;
  trigger?: "manual" | "webhook";
}

export async function enqueueDeployment(
  deps: {
    queue: Queue<DeployJobData>;
    store: DeploymentStore;
    logs: LogBus;
  },
  input: EnqueueDeployInput,
): Promise<{ projectId: string; jobId: string | undefined; host: string }> {
  await replacePendingDeploys(deps, input.image);
  const projectId = randomBytes(8).toString("hex");
  const host = appHost(input.image);

  await deps.store.save({
    projectId,
    projectName: input.projectName,
    repoUrl: input.repoUrl,
    image: input.image,
    port: "",
    status: "queued",
    host,
    createdAt: new Date().toISOString(),
    trigger: input.trigger ?? "manual",
    ...(input.commitHash ? { commitHash: input.commitHash } : {}),
  });
  await deps.logs.append(projectId, `Queued deploy of ${input.image}`);

  const job = await deps.queue.add(
    "deploy",
    {
      projectId,
      repoUrl: input.repoUrl,
      projectName: input.projectName,
      image: input.image,
      deploymentId: input.deploymentId,
      branch: input.branch,
      commitHash: input.commitHash,
      clearCache: input.clearCache,
      env: input.env,
    },
    { jobId: projectId },
  );

  return { projectId, jobId: job.id, host };
}

async function replacePendingDeploys(
  deps: {
    queue: Queue<DeployJobData>;
    store: DeploymentStore;
    logs: LogBus;
  },
  image: string,
): Promise<void> {
  const active = await deps.queue.getJobs(["active"]);
  if (active.some((job) => job.data.image === image)) {
    throw new DeployInProgressError();
  }

  const pending = await deps.queue.getJobs(["waiting", "delayed", "prioritized", "wait"]);
  const seen = new Set<string>();
  for (const job of pending) {
    if (job.data.image !== image || seen.has(job.data.projectId)) {
      continue;
    }
    seen.add(job.data.projectId);
    try {
      await job.remove();
    } catch {
      continue;
    }
    await deps.store.update(job.data.projectId, { status: "replaced" });
    await deps.logs.append(
      job.data.projectId,
      "Reemplazado por un despliegue más reciente",
    );
  }
}
