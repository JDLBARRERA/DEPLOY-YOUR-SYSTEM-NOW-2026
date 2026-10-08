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
  },
} as const;

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
      select: {
        id: true,
        name: true,
        repoUrl: true,
        branch: true,
        memoryLimit: true,
        cpuLimit: true,
      },
    });
    return projects;
  });

  app.patch<{
    Params: { id: string };
    Body: { memoryLimit?: string; cpuLimit?: number };
  }>(
    "/projects/:id",
    { schema: { body: updateSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      const memoryLimit = request.body.memoryLimit?.trim();
      const cpuLimit = request.body.cpuLimit;
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
      if (memoryLimit === undefined && cpuLimit === undefined) {
        return reply.code(400).send({ error: "No hay límites para actualizar" });
      }

      try {
        const updated = await prisma.project.update({
          where: { id: request.params.id },
          data: {
            ...(memoryLimit !== undefined ? { memoryLimit } : {}),
            ...(cpuLimit !== undefined ? { cpuLimit } : {}),
          },
          select: {
            id: true,
            name: true,
            repoUrl: true,
            branch: true,
            memoryLimit: true,
            cpuLimit: true,
          },
        });
        return updated;
      } catch {
        return reply.code(404).send({ error: "Proyecto no encontrado" });
      }
    },
  );
}
