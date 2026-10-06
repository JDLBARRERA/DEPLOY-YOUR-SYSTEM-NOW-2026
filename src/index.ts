import "dotenv/config";
import Fastify from "fastify";
import { deployRoutes } from "./routes/deploy.js";
import { DeployEngine } from "./services/DeployEngine.js";

const port = Number(process.env.PORT ?? 3000);

const app = Fastify({ logger: true });

await deployRoutes(app, new DeployEngine());

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
