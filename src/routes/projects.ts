import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/requireAdmin.js";
import { prisma } from "../db.js";
import { parseMemoryBytes, normalizeImageName } from "../services/DeployEngine.js";
import { appHost } from "../services/appHost.js";
import { CaddyClient } from "../services/CaddyClient.js";
import { normalizeCustomDomain } from "../services/customDomain.js";
import type { DeploymentStore } from "../services/DeploymentStore.js";

const MEMORY_LIMIT = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)$/i;

const updateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    memoryLimit: { type: "string", minLength: 2, maxLength: 16 },
    cpuLimit: { type: "number", minimum: 0.05, maximum: 16 },
    githubToken: { type: "string", maxLength: 300 },
    customDomain: { type: "string", maxLength: 253 },
  },
} as const;

const projectSelect = {
  id: true,
  name: true,
  repoUrl: true,
  branch: true,
  memoryLimit: true,
  cpuLimit: true,
  githubToken: true,
  customDomain: true,
} as const;

function publicProject<T extends { githubToken: string | null }>(
  project: T,
): Omit<T, "githubToken"> & { hasGithubToken: boolean } {
  const { githubToken, ...rest } = project;
  return { ...rest, hasGithubToken: Boolean(githubToken?.trim()) };
}

function validToken(value: string): boolean {
  return value.length > 0 && value.length <= 300 && !/[\s@]/.test(value);
}

function validMemory(value: string): boolean {
  const trimmed = value.trim();
  if (!MEMORY_LIMIT.test(trimmed)) {
    return false;
  }
  return parseMemoryBytes(trimmed) > 0;
}

function prismaCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
}

async function refreshRunningRoute(
  store: DeploymentStore | undefined,
  projectName: string,
  customDomain: string | null,
): Promise<void> {
  if (!store) {
    return;
  }
  try {
    const host = appHost(normalizeImageName(projectName));
    const records = await store.list();
    const running = records.filter(
      (record) => record.status === "running" && record.host === host,
    );
    if (running.length === 0) {
      return;
    }
    const caddy = new CaddyClient();
    for (const record of running) {
      const port = Number(record.port) || 8000;
      await caddy.upsertRoute(
        record.projectId,
        host,
        `paas-${record.projectId}:${port}`,
        customDomain,
      );
    }
  } catch (error) {
    console.error(
      `No se actualizó la ruta Caddy de ${projectName}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function projectRoutes(
  app: FastifyInstance,
  store?: DeploymentStore,
): Promise<void> {
  app.get("/projects", { preValidation: requireAdmin }, async () => {
    const projects = await prisma.project.findMany({
      orderBy: { name: "asc" },
      select: projectSelect,
    });
    return projects.map(publicProject);
  });

  app.patch<{
    Params: { id: string };
    Body: {
      memoryLimit?: string;
      cpuLimit?: number;
      githubToken?: string;
      customDomain?: string;
    };
  }>(
    "/projects/:id",
    { schema: { body: updateSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      const memoryLimit = request.body.memoryLimit?.trim();
      const cpuLimit = request.body.cpuLimit;
      const githubToken =
        request.body.githubToken === undefined
          ? undefined
          : request.body.githubToken.trim();
      let customDomain: string | null | undefined;
      if (request.body.customDomain === undefined) {
        customDomain = undefined;
      } else if (request.body.customDomain.trim().length === 0) {
        customDomain = null;
      } else {
        try {
          customDomain = normalizeCustomDomain(request.body.customDomain);
        } catch (error) {
          return reply.code(400).send({
            error: error instanceof Error ? error.message : "customDomain no es válido",
          });
        }
      }
      if (memoryLimit !== undefined && !validMemory(memoryLimit)) {
        return reply.code(400).send({
          error: "memoryLimit debe ser una cantidad como 256m, 512m o 1g",
        });
      }
      if (
        cpuLimit !== undefined &&
        (!Number.isFinite(cpuLimit) || cpuLimit <= 0 || cpuLimit > 16)
      ) {
        return reply.code(400).send({
          error: "cpuLimit debe ser un número entre 0 y 16",
        });
      }
      if (githubToken !== undefined && githubToken.length > 0 && !validToken(githubToken)) {
        return reply.code(400).send({
          error: "githubToken no es un token válido",
        });
      }
      if (
        memoryLimit === undefined &&
        cpuLimit === undefined &&
        githubToken === undefined &&
        customDomain === undefined
      ) {
        return reply.code(400).send({ error: "No hay cambios para guardar" });
      }

      try {
        const updated = await prisma.project.update({
          where: { id: request.params.id },
          data: {
            ...(memoryLimit !== undefined ? { memoryLimit } : {}),
            ...(cpuLimit !== undefined ? { cpuLimit } : {}),
            ...(githubToken !== undefined ? { githubToken: githubToken || null } : {}),
            ...(customDomain !== undefined ? { customDomain } : {}),
          },
          select: projectSelect,
        });
        if (customDomain !== undefined) {
          await refreshRunningRoute(store, updated.name, updated.customDomain);
        }
        return publicProject(updated);
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          return reply.code(409).send({ error: "Ese dominio ya está asignado a otro proyecto" });
        }
        if (prismaCode(error) === "P2025") {
          return reply.code(404).send({ error: "Proyecto no encontrado" });
        }
        request.log.error(error);
        return reply.code(500).send({ error: "No se pudo actualizar el proyecto" });
      }
    },
  );
}
