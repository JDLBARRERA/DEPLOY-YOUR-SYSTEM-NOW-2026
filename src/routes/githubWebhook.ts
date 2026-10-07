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
      if ("ignored" in result) {
        return reply.code(200).send({ ignored: true });
      }
      if (event === "push") {
        console.log("Trabajo encolado para:", repoUrlFromPayload(raw));
      }
      return reply.code(200).send(result);
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

function repoUrlFromPayload(raw: Buffer): string {
  const payload = JSON.parse(raw.toString("utf8")) as {
    repository?: { clone_url?: unknown; html_url?: unknown };
  };
  const cloneUrl = payload.repository?.clone_url;
  const htmlUrl = payload.repository?.html_url;
  if (typeof cloneUrl === "string" && cloneUrl) {
    return cloneUrl;
  }
  if (typeof htmlUrl === "string" && htmlUrl) {
    return htmlUrl;
  }
  return "";
}
