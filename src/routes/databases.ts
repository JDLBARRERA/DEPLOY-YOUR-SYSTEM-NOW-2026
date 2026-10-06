import type { FastifyInstance } from "fastify";
import {
  DatabaseManagerError,
  DatabaseManagerService,
} from "../services/DatabaseManagerService.js";

const createSchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 64 },
    projectId: { type: "string", minLength: 1 },
  },
} as const;

const branchSchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

const linkSchema = {
  type: "object",
  required: ["projectId"],
  additionalProperties: false,
  properties: {
    projectId: { type: "string", minLength: 1 },
  },
} as const;

function sendError(error: unknown): { status: number; error: string } {
  if (error instanceof DatabaseManagerError) {
    return { status: 400, error: error.message };
  }
  const message = error instanceof Error ? error.message : "Database request failed";
  return { status: 500, error: message };
}

export async function databaseRoutes(
  app: FastifyInstance,
  databases: DatabaseManagerService,
): Promise<void> {
  app.get("/databases", async () => databases.listDatabases());

  app.post<{ Body: { name: string; projectId?: string } }>(
    "/databases",
    { schema: { body: createSchema } },
    async (request, reply) => {
      try {
        const created = await databases.createDatabase(
          request.body.name,
          request.body.projectId,
        );
        return reply.code(201).send(created);
      } catch (error) {
        const result = sendError(error);
        return reply.code(result.status).send({ error: result.error });
      }
    },
  );

  app.post<{ Params: { dbName: string }; Body: { name: string } }>(
    "/databases/:dbName/branch",
    { schema: { body: branchSchema } },
    async (request, reply) => {
      try {
        const created = await databases.branchDatabase(
          request.params.dbName,
          request.body.name,
        );
        return reply.code(201).send(created);
      } catch (error) {
        const result = sendError(error);
        return reply.code(result.status).send({ error: result.error });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { projectId: string } }>(
    "/databases/:id/link",
    { schema: { body: linkSchema } },
    async (request, reply) => {
      try {
        const linked = await databases.linkDatabase(
          request.params.id,
          request.body.projectId,
        );
        return reply.send(linked);
      } catch (error) {
        const result = sendError(error);
        return reply.code(result.status).send({ error: result.error });
      }
    },
  );
}
