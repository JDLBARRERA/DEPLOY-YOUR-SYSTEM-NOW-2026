import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import Docker from "dockerode";
import { createDeployQueue } from "./queues/deployQueue.js";
import { deploymentRoutes } from "./routes/deployments.js";
import { databaseRoutes } from "./routes/databases.js";
import { deployRoutes } from "./routes/deploy.js";
import { githubWebhookRoutes } from "./routes/githubWebhook.js";
import { prisma } from "./db.js";
import { DatabaseManagerService } from "./services/DatabaseManagerService.js";
import { ContainerDatabaseService } from "./services/ContainerDatabaseService.js";
import { createRedis, pingRedis } from "./redis.js";
import { DeploymentStore } from "./services/DeploymentStore.js";
import { LogBus } from "./services/LogBus.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const sqliteMode = databaseUrl.startsWith("file:");

let dbReady = false;
if (sqliteMode) {
  console.warn(
    "[boot] DATABASE_URL es file:/SQLite. El motor Fastify usa Postgres en producción; para UI local usa mi-paas-dashboard (npm run dev) con store file:./dev.db.",
  );
} else {
  try {
    await prisma.$connect();
    dbReady = true;
  } catch (error) {
    console.warn(
      "[boot] Postgres/PgBouncer no disponible; rutas Prisma degradadas:",
      error instanceof Error ? error.message : error,
    );
  }
}

const databases = new DatabaseManagerService();
if (dbReady && !sqliteMode) {
  try {
    await databases.ensurePoolerAuth();
  } catch (error) {
    console.warn(
      "[boot] ensurePoolerAuth omitido:",
      error instanceof Error ? error.message : error,
    );
  }
}

const redisOk = await pingRedis();
if (!redisOk) {
  console.warn(
    "[boot] Redis no responde; API en modo degradado (sin worker/cola). El panel mi-paas-dashboard puede operar standalone.",
  );
}

if (redisOk) {
  try {
    await import("./workers/deployWorker.js");
  } catch (error) {
    console.warn(
      "[boot] worker no iniciado:",
      error instanceof Error ? error.message : error,
    );
  }
}

const port = Number(process.env.PORT ?? 3000);
const redis = createRedis({ degraded: !redisOk });
if (!redisOk) {
  try {
    await redis.connect();
  } catch {
    // Intencional: comandos fallarán con error claro, no congelan el proceso.
  }
}

const store = new DeploymentStore(redis);
const logs = new LogBus(redis);
const containerDatabases = new ContainerDatabaseService(redis);

const app = Fastify({ logger: true });
const queue = createDeployQueue(redis);

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
});

app.get("/health", async () => ({
  ok: true,
  dbReady,
  sqliteMode,
  redisOk,
  docker: await dockerPing(),
}));

await deployRoutes(app, {
  queue,
  store,
  logs,
});
await app.register((scope) =>
  githubWebhookRoutes(scope, {
    queue,
    store,
    logs,
    databases,
  }),
);
await databaseRoutes(app, databases, containerDatabases);

const docker = new Docker();
try {
  await Promise.race([
    docker.ping(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("docker ping timeout")), 2_000),
    ),
  ]);
} catch (error) {
  console.warn(
    "[boot] Docker API no responde; deployments/list no inspeccionarán contenedores:",
    error instanceof Error ? error.message : error,
  );
}

await deploymentRoutes(app, {
  store,
  logs,
  docker,
  queue,
});

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function dockerPing(): Promise<boolean> {
  try {
    const client = new Docker();
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2_000),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}
