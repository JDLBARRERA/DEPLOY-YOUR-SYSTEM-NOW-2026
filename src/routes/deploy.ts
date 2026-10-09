import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/requireAdmin.js";
import { prisma } from "../db.js";
import type { DeployJobData } from "../queues/deployQueue.js";
import { enqueueDeployment } from "../services/enqueueDeployment.js";
import {
  assertGitBranch,
  assertGitCommit,
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
    branch: { type: "string", minLength: 1 },
    commitHash: { type: "string", minLength: 7 },
    clearCache: { type: "boolean" },
  },
} as const;

interface DeployBody {
  repoUrl: string;
  projectName: string;
  deploymentId?: string;
  branch?: string;
  commitHash?: string;
  clearCache?: boolean;
}

export interface DeployRouteDeps {
  queue: Queue<DeployJobData>;
  store: DeploymentStore;
  logs: LogBus;
}

async function deploymentForNamedProject(
  projectName: string,
  image: string,
  branch: string,
): Promise<string | undefined> {
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  const exact = projects.find((project) => project.name.trim() === projectName.trim());
  const normalized = projects.find((project) => {
    try {
      return normalizeImageName(project.name) === image;
    } catch {
      return false;
    }
  });
  const project = exact ?? normalized;
  if (!project) {
    return undefined;
  }
  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: "queued",
      type: "PRODUCTION",
      branch,
    },
    select: { id: true },
  });
  return deployment.id;
}

export async function deployRoutes(
  app: FastifyInstance,
  deps: DeployRouteDeps,
): Promise<void> {
  app.post<{ Body: DeployBody }>(
    "/deploy",
    { schema: { body: deployBodySchema }, preValidation: requireAdmin },
    async (request, reply) => {
      try {
        assertPublicGitHubRepo(request.body.repoUrl);
        const branch = (request.body.branch ?? "main").trim() || "main";
        assertGitBranch(branch);
        const commitHash = request.body.commitHash?.trim();
        if (commitHash) {
          assertGitCommit(commitHash);
        }
        const image = normalizeImageName(request.body.projectName);
        const deploymentId =
          request.body.deploymentId ??
          (await deploymentForNamedProject(request.body.projectName, image, branch));
        const queued = await enqueueDeployment(deps, {
          repoUrl: request.body.repoUrl,
          projectName: request.body.projectName,
          image,
          deploymentId,
          branch,
          commitHash: commitHash || undefined,
          clearCache: request.body.clearCache === true,
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
        const soft =
          /ECONNREFUSED|ENOTFOUND|Redis|Connection is closed|docker|timed out/i.test(
            message,
          );
        return reply.code(soft ? 503 : 500).send({
          error: soft
            ? `Motor local no disponible (${message}). Usa mi-paas-dashboard en modo standalone o arranca Redis/Docker.`
            : message,
        });
      }
    },
  );
}
