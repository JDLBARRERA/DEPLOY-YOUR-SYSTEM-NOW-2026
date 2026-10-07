import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const DEPLOY_QUEUE_NAME = "deploys";

export interface DeployJobData {
  projectId: string;
  repoUrl: string;
  projectName: string;
  image: string;
  deploymentId?: string;
  branch?: string;
  commitHash?: string;
  clearCache?: boolean;
  env?: Record<string, string>;
}

export function createDeployQueue(connection: Redis): Queue<DeployJobData> {
  return new Queue<DeployJobData>(DEPLOY_QUEUE_NAME, { connection });
}
