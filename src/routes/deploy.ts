import type { FastifyInstance } from "fastify";
import {
  DeployEngine,
  DeployValidationError,
  type DeployRequest,
} from "../services/DeployEngine.js";

const deployBodySchema = {
  type: "object",
  required: ["repoUrl", "projectName"],
  additionalProperties: false,
  properties: {
    repoUrl: { type: "string", minLength: 1 },
    projectName: { type: "string", minLength: 1 },
  },
} as const;

export async function deployRoutes(
  app: FastifyInstance,
  engine: DeployEngine,
): Promise<void> {
  app.post<{ Body: DeployRequest }>(
    "/deploy",
    { schema: { body: deployBodySchema } },
    async (request, reply) => {
      try {
        return await engine.deploy(request.body);
      } catch (error) {
        if (error instanceof DeployValidationError) {
          return reply.code(400).send({ error: error.message });
        }

        const message = error instanceof Error ? error.message : "Deploy failed";
        return reply.code(500).send({ error: message });
      }
    },
  );
}
