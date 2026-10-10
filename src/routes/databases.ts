import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/requireAdmin.js";
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
import {
  createHostedDatabase,
  deleteHostedDatabase,
  HostedDatabaseError,
  listHostedDatabases,
  type HostedDatabaseType,
} from "../services/HostedDatabaseService.js";

const ENGINES = ["postgres", "POSTGRES", "mysql", "redis", "REDIS"] as const;

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

function fromHosted(row: {
  id: string;
  name: string;
  type: HostedDatabaseType;
  connectionString: string;
  status: string;
  createdAt: Date;
}): DatabaseListItem & { connectionString: string } {
  const engine: DatabaseEngine = row.type === "REDIS" ? "redis" : "postgres";
  return {
    id: row.id,
    name: row.name,
    type: engine,
    status: row.status,
    dbName: row.name,
    host: `paas-db-${row.id}`,
    port: engine === "redis" ? 6379 : 5432,
    databaseUrl: row.connectionString,
    pooledUrl: row.connectionString,
    directUrl: row.connectionString,
    connectionString: row.connectionString,
    projectId: null,
    createdAt: row.createdAt.toISOString(),
  };
}

function hostedType(value: string | undefined): HostedDatabaseType | null {
  if (value === "postgres" || value === "POSTGRES") return "POSTGRES";
  if (value === "redis" || value === "REDIS") return "REDIS";
  return null;
}

function sendError(error: unknown): { status: number; error: string } {
  if (
    error instanceof DatabaseManagerError ||
    error instanceof ContainerDatabaseError ||
    error instanceof HostedDatabaseError
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
  app.get("/databases", { preValidation: requireAdmin }, async () => {
    const [legacy, docker, hosted] = await Promise.all([
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
      listHostedDatabases().catch((error: unknown) => {
        console.warn(
          "[databases] list contenedores omitido:",
          error instanceof Error ? error.message : error,
        );
        return [] as Awaited<ReturnType<typeof listHostedDatabases>>;
      }),
    ]);
    return [
      ...hosted.map(fromHosted),
      ...docker.map(fromContainer),
      ...legacy.map(fromLegacy),
    ];
  });

  app.post<{
    Body: { name: string; type?: DatabaseEngine | "POSTGRES" | "REDIS"; projectId?: string };
  }>(
    "/databases",
    { schema: { body: createSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      try {
        const type = request.body.type;
        const hosted = hostedType(type);
        if (hosted) {
          const created = await createHostedDatabase(request.body.name, hosted);
          const item = fromHosted(created);
          return reply.code(201).send({
            ...item,
            DATABASE_URL: item.databaseUrl,
          });
        }
        if (type === "mysql") {
          const created = await containers.create(request.body.name, "mysql");
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

  app.delete<{ Params: { id: string } }>(
    "/databases/:id",
    { preValidation: requireAdmin },
    async (request, reply) => {
      try {
        await deleteHostedDatabase(request.params.id);
        await containers.remove(request.params.id);
        return reply.code(200).send({ ok: true });
      } catch (error) {
        const result = sendError(error);
        return reply.code(result.status).send({ error: result.error });
      }
    },
  );

  app.post<{ Params: { dbName: string }; Body: { name: string } }>(
    "/databases/:dbName/branch",
    { schema: { body: branchSchema }, preValidation: requireAdmin },
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
    { schema: { body: linkSchema }, preValidation: requireAdmin },
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
