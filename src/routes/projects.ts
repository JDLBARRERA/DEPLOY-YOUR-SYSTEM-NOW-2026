import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/requireAdmin.js";
import { prisma } from "../db.js";
import { parseMemoryBytes } from "../services/DeployEngine.js";

const MEMORY_LIMIT = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)$/i;

const updateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    memoryLimit: { type: "string", minLength: 2, maxLength: 16 },
    cpuLimit: { type: "number", minimum: 0.05, maximum: 16 },
    githubToken: { type: "string", maxLength: 300 },
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

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/projects", { preValidation: requireAdmin }, async () => {
    const projects = await prisma.project.findMany({
      orderBy: { name: "asc" },
      select: projectSelect,
    });
    return projects.map(publicProject);
  });

  app.patch<{
    Params: { id: string };
    Body: { memoryLimit?: string; cpuLimit?: number; githubToken?: string };
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
      if (memoryLimit === undefined && cpuLimit === undefined && githubToken === undefined) {
        return reply.code(400).send({ error: "No hay cambios para guardar" });
      }

      try {
        const updated = await prisma.project.update({
          where: { id: request.params.id },
          data: {
            ...(memoryLimit !== undefined ? { memoryLimit } : {}),
            ...(cpuLimit !== undefined ? { cpuLimit } : {}),
            ...(githubToken !== undefined ? { githubToken: githubToken || null } : {}),
          },
          select: projectSelect,
        });
        return publicProject(updated);
      } catch {
        return reply.code(404).send({ error: "Proyecto no encontrado" });
      }
    },
  );
}
