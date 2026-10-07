import "dotenv/config";
import "./workers/deployWorker.js";
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
import { createRedis } from "./redis.js";
import { DeploymentStore } from "./services/DeploymentStore.js";
import { LogBus } from "./services/LogBus.js";

await prisma.$connect();
const databases = new DatabaseManagerService();
await databases.ensurePoolerAuth();

const port = Number(process.env.PORT ?? 3000);
const redis = createRedis();
const store = new DeploymentStore(redis);
const logs = new LogBus(redis);

const app = Fastify({ logger: true });
const queue = createDeployQueue(redis);

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
});
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
await databaseRoutes(app, databases);
await deploymentRoutes(app, {
  store,
  logs,
  docker: new Docker(),
  queue,
});

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
