import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { DeployJobData } from "../queues/deployQueue.js";
import {
  GitHubWebhookService,
  WebhookSignatureError,
} from "../services/GitHubWebhook.js";
import type { DatabaseManagerService } from "../services/DatabaseManagerService.js";
import type { DeploymentStore } from "../services/DeploymentStore.js";
import type { LogBus } from "../services/LogBus.js";

export async function githubWebhookRoutes(
  app: FastifyInstance,
  deps: {
    queue: Queue<DeployJobData>;
    store: DeploymentStore;
    logs: LogBus;
    databases: DatabaseManagerService;
  },
): Promise<void> {
  const webhooks = new GitHubWebhookService(deps);

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.post("/webhooks/github", { bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const raw = request.body;
    if (!Buffer.isBuffer(raw)) {
      return reply.code(400).send({ error: "El cuerpo del webhook debe ser JSON" });
    }

    const eventHeader = request.headers["x-github-event"];
    const signature = request.headers["x-hub-signature-256"];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;

    try {
      const result = await webhooks.receive(event, raw, signatureValue);
      if (result.repoUrl) {
        const projects = (result.projectRepoUrls ?? []).map((repositoryUrl) => ({
          repositoryUrl,
        }));
        console.log("Webhook recibido para URL limpia:", result.repoUrl);
        console.log(
          "Proyectos en DB:",
          projects.map((p) => p.repositoryUrl),
        );
      }
      if ("ignored" in result) {
        if (result.missingProject) {
          console.log("No se encontró proyecto coincidente");
        }
        return reply.code(200).send({ ignored: true });
      }
      console.log("Trabajo encolado exitosamente");
      return reply.code(200).send({ deployments: result.deployments });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        return reply.code(401).send({ error: error.message });
      }
      if (error instanceof SyntaxError) {
        return reply.code(400).send({ error: "JSON inválido" });
      }
      const message = error instanceof Error ? error.message : "Webhook failed";
      return reply.code(500).send({ error: message });
    }
  });
}

