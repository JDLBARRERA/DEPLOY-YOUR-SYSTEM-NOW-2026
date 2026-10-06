import type { FastifyInstance } from "fastify";
import Docker from "dockerode";
import type { DeploymentRecord, DeploymentStore } from "../services/DeploymentStore.js";
import type { LogBus } from "../services/LogBus.js";

const CONTAINER_PORT = "3000";

export interface DeploymentRouteDeps {
  store: DeploymentStore;
  logs: LogBus;
  docker: Docker;
}

function toResponse(record: DeploymentRecord) {
  const port = record.port ? Number(record.port) : null;
  return {
    projectId: record.projectId,
    projectName: record.projectName,
    repoUrl: record.repoUrl,
    image: record.image,
    port,
    status: record.status,
    host: record.host,
    url: `http://${record.host}`,
    createdAt: record.createdAt,
  };
}

async function refreshFromDocker(
  docker: Docker,
  store: DeploymentStore,
  record: DeploymentRecord,
): Promise<DeploymentRecord> {
  try {
    const info = await docker.getContainer(`paas-${record.projectId}`).inspect();
    const binding = info.NetworkSettings.Ports?.[`${CONTAINER_PORT}/tcp`]?.[0];
    const port = binding?.HostPort ?? record.port;
    const status = info.State.Running ? info.State.Status : record.status;

    if (port !== record.port || status !== record.status) {
      const next = { ...record, port, status };
      await store.update(record.projectId, { port, status });
      return next;
    }

    return record;
  } catch {
    return record;
  }
}

export async function deploymentRoutes(
  app: FastifyInstance,
  deps: DeploymentRouteDeps,
): Promise<void> {
  app.get("/deployments", async () => {
    const records = await deps.store.list();
    const refreshed = await Promise.all(
      records.map((record) => refreshFromDocker(deps.docker, deps.store, record)),
    );
    return refreshed.map(toResponse);
  });

  app.get<{ Params: { projectId: string } }>(
    "/deployments/:projectId/logs",
    async (request, reply) => {
      const { projectId } = request.params;
      const record = await deps.store.get(projectId);
      if (!record) {
        return reply.code(404).send({ error: "Deployment not found" });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "http://localhost:3001",
      });

      const send = (line: string) => {
        reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
      };

      const history = await deps.logs.history(projectId);
      for (const line of history) {
        send(line);
      }

      const unsubscribe = await deps.logs.subscribe(projectId, send);
      const close = () => {
        void unsubscribe();
      };
      request.raw.on("close", close);
    },
  );
}
