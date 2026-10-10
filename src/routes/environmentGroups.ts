import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/requireAdmin.js";
import { prisma } from "../db.js";
import { normalizeEnvPair } from "../services/projectEnv.js";

const nameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
  },
} as const;

const variableCreateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "value"],
  properties: {
    key: { type: "string", minLength: 1, maxLength: 128 },
    value: { type: "string", maxLength: 8000 },
  },
} as const;

const variableUpdateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value"],
  properties: {
    value: { type: "string", maxLength: 8000 },
  },
} as const;

const groupSelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  variables: {
    orderBy: { key: "asc" as const },
    select: { id: true, key: true, value: true },
  },
} as const;

function prismaCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
}

function groupName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || /[\r\n]/.test(name)) {
    throw new Error("El nombre del grupo no es válido");
  }
  return name;
}

export async function environmentGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/environment-groups", { preValidation: requireAdmin }, async () => {
    return prisma.environmentGroup.findMany({
      orderBy: { name: "asc" },
      select: groupSelect,
    });
  });

  app.post<{ Body: { name: string } }>(
    "/environment-groups",
    { schema: { body: nameSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      try {
        const created = await prisma.environmentGroup.create({
          data: { name: groupName(request.body.name) },
          select: groupSelect,
        });
        return reply.code(201).send(created);
      } catch (error) {
        if (error instanceof Error && error.message === "El nombre del grupo no es válido") {
          return reply.code(400).send({ error: error.message });
        }
        if (prismaCode(error) === "P2002") {
          return reply.code(409).send({ error: "Ya existe un grupo con ese nombre" });
        }
        return reply.code(500).send({ error: "No se pudo crear el grupo" });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/environment-groups/:id",
    { schema: { body: nameSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      try {
        const updated = await prisma.environmentGroup.update({
          where: { id: request.params.id },
          data: { name: groupName(request.body.name) },
          select: groupSelect,
        });
        return updated;
      } catch (error) {
        if (error instanceof Error && error.message === "El nombre del grupo no es válido") {
          return reply.code(400).send({ error: error.message });
        }
        if (prismaCode(error) === "P2002") {
          return reply.code(409).send({ error: "Ya existe un grupo con ese nombre" });
        }
        if (prismaCode(error) === "P2025") {
          return reply.code(404).send({ error: "Grupo no encontrado" });
        }
        return reply.code(500).send({ error: "No se pudo renombrar el grupo" });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/environment-groups/:id",
    { preValidation: requireAdmin },
    async (request, reply) => {
      try {
        await prisma.environmentGroup.delete({ where: { id: request.params.id } });
        return { ok: true };
      } catch (error) {
        if (prismaCode(error) === "P2025") {
          return reply.code(404).send({ error: "Grupo no encontrado" });
        }
        return reply.code(500).send({ error: "No se pudo eliminar el grupo" });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { key: string; value: string } }>(
    "/environment-groups/:id/variables",
    { schema: { body: variableCreateSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      let pair: { key: string; value: string };
      try {
        pair = normalizeEnvPair(request.body.key, request.body.value);
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Variable inválida",
        });
      }
      const group = await prisma.environmentGroup.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!group) {
        return reply.code(404).send({ error: "Grupo no encontrado" });
      }
      try {
        const created = await prisma.groupVariable.create({
          data: { groupId: group.id, key: pair.key, value: pair.value },
          select: { id: true, key: true, value: true },
        });
        return reply.code(201).send(created);
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          return reply.code(409).send({ error: "Esa clave ya existe en el grupo" });
        }
        return reply.code(500).send({ error: "No se pudo guardar la variable" });
      }
    },
  );

  app.patch<{ Params: { id: string; variableId: string }; Body: { value: string } }>(
    "/environment-groups/:id/variables/:variableId",
    { schema: { body: variableUpdateSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      const current = await prisma.groupVariable.findFirst({
        where: { id: request.params.variableId, groupId: request.params.id },
        select: { id: true, key: true },
      });
      if (!current) {
        return reply.code(404).send({ error: "Variable no encontrada" });
      }
      try {
        const pair = normalizeEnvPair(current.key, request.body.value);
        return await prisma.groupVariable.update({
          where: { id: current.id },
          data: { value: pair.value },
          select: { id: true, key: true, value: true },
        });
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Variable inválida",
        });
      }
    },
  );

  app.delete<{ Params: { id: string; variableId: string } }>(
    "/environment-groups/:id/variables/:variableId",
    { preValidation: requireAdmin },
    async (request, reply) => {
      const current = await prisma.groupVariable.findFirst({
        where: { id: request.params.variableId, groupId: request.params.id },
        select: { id: true },
      });
      if (!current) {
        return reply.code(404).send({ error: "Variable no encontrada" });
      }
      await prisma.groupVariable.delete({ where: { id: current.id } });
      return { ok: true };
    },
  );
}
