import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { DeployJobData } from "../queues/deployQueue.js";
import { enqueueDeployment } from "../services/enqueueDeployment.js";
import {
  assertPublicGitHubRepo,
  DeployValidationError,
  normalizeImageName,
} from "../services/DeployEngine.js";
import type { DeploymentStore } from "../services/DeploymentStore.js";
import type { LogBus } from "../services/LogBus.js";

const deployBodySchema = {
  type: "object",
  required: ["repoUrl", "projectName"],
  additionalProperties: false,
  properties: {
    repoUrl: { type: "string", minLength: 1 },
    projectName: { type: "string", minLength: 1 },
    deploymentId: { type: "string", minLength: 1 },
  },
} as const;

interface DeployBody {
  repoUrl: string;
  projectName: string;
  deploymentId?: string;
}

export interface DeployRouteDeps {
  queue: Queue<DeployJobData>;
  store: DeploymentStore;
  logs: LogBus;
}

export async function deployRoutes(
  app: FastifyInstance,
  deps: DeployRouteDeps,
): Promise<void> {
  app.post<{ Body: DeployBody }>(
    "/deploy",
    { schema: { body: deployBodySchema } },
    async (request, reply) => {
      try {
        assertPublicGitHubRepo(request.body.repoUrl);
        const image = normalizeImageName(request.body.projectName);
        const queued = await enqueueDeployment(deps, {
          repoUrl: request.body.repoUrl,
          projectName: request.body.projectName,
          image,
          deploymentId: request.body.deploymentId,
        });

        return reply.code(202).send({
          projectId: queued.projectId,
          jobId: queued.jobId,
          status: "queued",
        });
      } catch (error) {
        if (error instanceof DeployValidationError) {
          return reply.code(400).send({ error: error.message });
        }

        const message = error instanceof Error ? error.message : "Deploy failed";
        return reply.code(500).send({ error: message });
      }
    },
  );
}
