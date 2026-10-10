import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/requireAdmin.js";
import { prisma } from "../db.js";
import type { DeployJobData } from "../queues/deployQueue.js";
import { DeployInProgressError, enqueueDeployment } from "../services/enqueueDeployment.js";
import {
  assertGitBranch,
  assertGitCommit,
  assertPublicGitHubRepo,
  DeployValidationError,
  normalizeImageName,
} from "../services/DeployEngine.js";
import type { DeploymentStore } from "../services/DeploymentStore.js";
import type { LogBus } from "../services/LogBus.js";
import { normalizeEnvPair, replaceProjectEnvironmentGroups, assignProjectEcosystem, normalizeStartCommand } from "../services/projectEnv.js";

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
    serviceType: { type: "string", enum: ["web", "worker"] },
    startCommand: { type: "string", maxLength: 500 },
    ecosystemName: { type: "string", maxLength: 80 },
    environmentGroupIds: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 64 },
    },
    variables: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 128 },
          value: { type: "string", maxLength: 8000 },
        },
      },
    },
  },
} as const;

interface DeployBody {
  repoUrl: string;
  projectName: string;
  deploymentId?: string;
  branch?: string;
  commitHash?: string;
  clearCache?: boolean;
  serviceType?: "web" | "worker";
  startCommand?: string;
  ecosystemName?: string;
  environmentGroupIds?: string[];
  variables?: Array<{ key: string; value: string }>;
}

export interface DeployRouteDeps {
  queue: Queue<DeployJobData>;
  store: DeploymentStore;
  logs: LogBus;
}

function parsedVariables(
  variables: Array<{ key: string; value: string }> | undefined,
): Array<{ key: string; value: string }> {
  const pairs = variables ?? [];
  const seen = new Set<string>();
  const parsed: Array<{ key: string; value: string }> = [];
  for (const variable of pairs) {
    let pair: { key: string; value: string };
    try {
      pair = normalizeEnvPair(variable.key, variable.value);
    } catch (error) {
      throw new DeployValidationError(
        error instanceof Error ? error.message : "Variable inválida",
      );
    }
    if (seen.has(pair.key)) {
      throw new DeployValidationError(`La clave ${pair.key} está repetida`);
    }
    seen.add(pair.key);
    parsed.push(pair);
  }
  return parsed;
}

async function projectForDeploy(
  projectName: string,
  image: string,
  repoUrl: string,
  branch: string,
  createIfMissing: boolean,
  serviceType: "web" | "worker",
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
  const existing = exact ?? normalized;
  if (existing) {
    return existing.id;
  }
  if (!createIfMissing) {
    return undefined;
  }
  const team = await prisma.team.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!team) {
    throw new DeployValidationError("No hay un equipo para guardar las variables");
  }
  const created = await prisma.project.create({
    data: {
      name: projectName.trim(),
      repoUrl,
      branch,
      teamId: team.id,
      serviceType,
    },
    select: { id: true },
  });
  return created.id;
}

async function saveProjectVariables(
  projectId: string,
  variables: Array<{ key: string; value: string }>,
): Promise<void> {
  for (const variable of variables) {
    await prisma.environmentVariable.upsert({
      where: { projectId_key: { projectId, key: variable.key } },
      create: { projectId, key: variable.key, value: variable.value },
      update: { value: variable.value },
    });
  }
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
        const requestedType =
          request.body.serviceType === "worker"
            ? "worker"
            : request.body.serviceType === "web"
              ? "web"
              : undefined;
        const image = normalizeImageName(request.body.projectName);
        const variables = parsedVariables(request.body.variables);
        const environmentGroupIds = request.body.environmentGroupIds;
        const startCommand =
          request.body.startCommand === undefined
            ? undefined
            : normalizeStartCommand(request.body.startCommand);
        const projectId = await projectForDeploy(
          request.body.projectName,
          image,
          request.body.repoUrl,
          branch,
          variables.length > 0 ||
            requestedType === "worker" ||
            (environmentGroupIds?.length ?? 0) > 0 ||
            Boolean(startCommand) ||
            Boolean(request.body.ecosystemName?.trim()),
          requestedType ?? "web",
        );
        let serviceType: "web" | "worker" = requestedType ?? "web";
        if (projectId && requestedType === undefined) {
          const current = await prisma.project.findUnique({
            where: { id: projectId },
            select: { serviceType: true },
          });
          serviceType = current?.serviceType === "worker" ? "worker" : "web";
        }
        if (projectId && (requestedType !== undefined || startCommand !== undefined)) {
          await prisma.project.update({
            where: { id: projectId },
            data: {
              ...(requestedType !== undefined ? { serviceType: requestedType } : {}),
              ...(startCommand !== undefined ? { startCommand } : {}),
            },
          });
        }
        if (projectId) {
          if (variables.length > 0) {
            await saveProjectVariables(projectId, variables);
          }
          if (request.body.ecosystemName !== undefined) {
            try {
              await assignProjectEcosystem(projectId, request.body.ecosystemName);
            } catch (error) {
              throw new DeployValidationError(
                error instanceof Error ? error.message : "No se pudo asignar el ecosistema",
              );
            }
          }
          if (environmentGroupIds) {
            try {
              await replaceProjectEnvironmentGroups(projectId, environmentGroupIds);
            } catch (error) {
              throw new DeployValidationError(
                error instanceof Error ? error.message : "No se pudieron vincular los grupos",
              );
            }
          }
        }
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
          trigger: "manual",
          serviceType,
        });

        return reply.code(202).send({
          projectId: queued.projectId,
          jobId: queued.jobId,
          status: "queued",
        });
      } catch (error) {
        if (error instanceof DeployInProgressError) {
          return reply.code(409).send({ error: error.message });
        }
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
