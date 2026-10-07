import { randomBytes } from "node:crypto";
import type { Queue } from "bullmq";
import type { DeployJobData } from "../queues/deployQueue.js";
import type { DeploymentStore } from "./DeploymentStore.js";
import { appHost } from "./appHost.js";
import type { LogBus } from "./LogBus.js";

export interface EnqueueDeployInput {
  repoUrl: string;
  projectName: string;
  image: string;
  deploymentId?: string;
  branch?: string;
  env?: Record<string, string>;
}

export async function enqueueDeployment(
  deps: {
    queue: Queue<DeployJobData>;
    store: DeploymentStore;
    logs: LogBus;
  },
  input: EnqueueDeployInput,
): Promise<{ projectId: string; jobId: string | undefined; host: string }> {
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
      env: input.env,
    },
    { jobId: projectId },
  );

  return { projectId, jobId: job.id, host };
}
