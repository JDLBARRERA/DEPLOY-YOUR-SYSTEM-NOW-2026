import type { FastifyInstance } from "fastify";
import {
  DatabaseManagerError,
  DatabaseManagerService,
  type ManagedDatabase,
} from "../services/DatabaseManagerService.js";
import {
  ContainerDatabaseError,
  ContainerDatabaseService,
  type ContainerDatabaseRecord,
  type DatabaseEngine,
} from "../services/ContainerDatabaseService.js";

const ENGINES = ["postgres", "mysql", "redis"] as const;

const createSchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 64 },
    type: { type: "string", enum: [...ENGINES] },
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

export interface DatabaseListItem {
  id: string;
  name: string;
  type: DatabaseEngine | "postgres";
  status: string;
  dbName: string;
  dbUser?: string;
  host: string;
  port: number;
  pooledPort?: number;
  databaseUrl: string;
  pooledUrl: string;
  directUrl: string;
  projectId: string | null;
  createdAt: string;
}

function fromLegacy(row: ManagedDatabase): DatabaseListItem {
  return {
    id: row.id,
    name: row.name,
    type: "postgres",
    status: "running",
    dbName: row.dbName,
    dbUser: row.dbUser,
    host: row.host,
    port: row.port,
    pooledPort: row.pooledPort,
    databaseUrl: row.pooledUrl || row.directUrl,
    pooledUrl: row.pooledUrl,
    directUrl: row.directUrl,
    projectId: row.projectId,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

function fromContainer(row: ContainerDatabaseRecord): DatabaseListItem {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    dbName: row.dbName,
    dbUser: row.dbUser,
    host: row.host,
    port: row.port,
    databaseUrl: row.databaseUrl,
    pooledUrl: row.pooledUrl,
    directUrl: row.directUrl,
    projectId: row.projectId,
    createdAt: row.createdAt,
  };
}

function sendError(error: unknown): { status: number; error: string } {
  if (
    error instanceof DatabaseManagerError ||
    error instanceof ContainerDatabaseError
  ) {
    return { status: 400, error: error.message };
  }
  const message = error instanceof Error ? error.message : "Database request failed";
  return { status: 500, error: message };
}

export async function databaseRoutes(
  app: FastifyInstance,
  databases: DatabaseManagerService,
  containers: ContainerDatabaseService,
): Promise<void> {
  app.get("/databases", async () => {
    const [legacy, docker] = await Promise.all([
      databases.listDatabases().catch((error: unknown) => {
        console.warn(
          "[databases] list Postgres omitido:",
          error instanceof Error ? error.message : error,
        );
        return [] as Awaited<ReturnType<typeof databases.listDatabases>>;
      }),
      containers.list().catch((error: unknown) => {
        console.warn(
          "[databases] list Docker/Redis omitido:",
          error instanceof Error ? error.message : error,
        );
        return [] as Awaited<ReturnType<typeof containers.list>>;
      }),
    ]);
    return [
      ...docker.map(fromContainer),
      ...legacy.map(fromLegacy),
    ];
  });

  app.post<{
    Body: { name: string; type?: DatabaseEngine; projectId?: string };
  }>(
    "/databases",
    { schema: { body: createSchema } },
    async (request, reply) => {
      try {
        const type = request.body.type;
        if (type) {
          const created = await containers.create(request.body.name, type);
          return reply.code(201).send({
            ...fromContainer(created),
            DATABASE_URL: created.databaseUrl,
          });
        }

        const created = await databases.createDatabase(
          request.body.name,
          request.body.projectId,
        );
        const item = fromLegacy(created);
        return reply.code(201).send({
          ...item,
          DATABASE_URL: item.databaseUrl,
        });
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
        return reply.code(201).send(fromLegacy(created));
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
        return reply.send(fromLegacy(linked));
      } catch (error) {
        const result = sendError(error);
        return reply.code(result.status).send({ error: result.error });
      }
    },
  );
}
