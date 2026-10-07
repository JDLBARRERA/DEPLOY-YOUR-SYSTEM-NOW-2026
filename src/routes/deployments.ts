import type { Queue } from "bullmq";
import type { FastifyInstance } from "fastify";
import Docker from "dockerode";
import { prisma } from "../db.js";
import type { DeployJobData } from "../queues/deployQueue.js";
import type { DeploymentRecord, DeploymentStore } from "../services/DeploymentStore.js";
import { publicUrlForHost } from "../services/appHost.js";
import {
  assertGitBranch,
  assertGitCommit,
  DeployValidationError,
  normalizeImageName,
} from "../services/DeployEngine.js";
import { enqueueDeployment } from "../services/enqueueDeployment.js";
import type { LogBus } from "../services/LogBus.js";

const CONTAINER_PORT = "3000";

export interface DeploymentRouteDeps {
  store: DeploymentStore;
  logs: LogBus;
  docker: Docker;
  queue: Queue<DeployJobData>;
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
    url: publicUrlForHost(record.host),
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

  app.post<{ Params: { id: string } }>(
    "/deployments/:id/redeploy",
    async (request, reply) => {
      try {
        const source = await prisma.deployment.findUnique({
          where: { id: request.params.id },
          include: {
            project: {
              select: {
                id: true,
                name: true,
                repoUrl: true,
                branch: true,
              },
            },
          },
        });
        if (!source) {
          return reply.code(404).send({ error: "Deployment not found" });
        }

        const branch =
          (source.branch ?? source.project.branch ?? "main").trim() || "main";
        assertGitBranch(branch);
        const commitHash = source.commitHash?.trim() || undefined;
        if (commitHash) {
          assertGitCommit(commitHash);
        }

        const redeploy = await prisma.deployment.create({
          data: {
            projectId: source.projectId,
            status: "queued",
            type: source.type,
            branch,
            commitHash: commitHash ?? null,
            commitMessage: source.commitMessage,
            commitAuthor: source.commitAuthor,
            commitAuthorAvatar: source.commitAuthorAvatar,
          },
        });

        const image = normalizeImageName(source.project.name);
        const queued = await enqueueDeployment(deps, {
          repoUrl: source.project.repoUrl,
          projectName: source.project.name,
          image,
          deploymentId: redeploy.id,
          branch,
          commitHash,
        });

        return reply.code(202).send({
          projectId: queued.projectId,
          jobId: queued.jobId,
          deploymentId: redeploy.id,
          status: "queued",
        });
      } catch (error) {
        if (error instanceof DeployValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        const message = error instanceof Error ? error.message : "Redeploy failed";
        return reply.code(500).send({ error: message });
      }
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/deployments/:projectId/logs",
    async (request, reply) => {
      const { projectId } = request.params;
      const record = await deps.store.get(projectId);
      if (!record) {
        return reply.code(404).send({ error: "Deployment not found" });
      }

      reply.hijack();
      reply.raw.writeHead(200, sseHeaders());

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

  app.get<{ Params: { projectId: string } }>(
    "/deployments/:projectId/stats",
    async (request, reply) => {
      const { projectId } = request.params;
      reply.hijack();
      reply.raw.writeHead(200, sseHeaders());

      const send = (payload: { cpu: number | null; memoryMb: number | null }) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
      };

      if (!/^[a-f0-9]{16}$/.test(projectId)) {
        send({ cpu: null, memoryMb: null });
        reply.raw.end();
        return;
      }

      const container = deps.docker.getContainer(`paas-${projectId}`);
      let stream: NodeJS.ReadableStream;
      try {
        await container.inspect();
        stream = (await container.stats({ stream: true })) as NodeJS.ReadableStream;
      } catch {
        send({ cpu: null, memoryMb: null });
        reply.raw.end();
        return;
      }

      let buffer = "";
      const onData = (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const parts = buffer.split(/\n/);
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line) {
            continue;
          }
          try {
            send(readContainerStats(JSON.parse(line) as DockerStatsSample));
          } catch {
            // A partial Docker frame is completed by the next chunk.
          }
        }
      };

      const close = () => {
        stream.off("data", onData);
        const destroyable = stream as NodeJS.ReadableStream & { destroy?: () => void };
        destroyable.destroy?.();
      };

      stream.on("data", onData);
      stream.on("error", close);
      stream.on("end", () => {
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      });
      request.raw.on("close", close);
    },
  );
}

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "http://localhost:3000",
  };
}

interface DockerStatsSample {
  cpu_stats?: {
    online_cpus?: number;
    system_cpu_usage?: number;
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
  };
  precpu_stats?: {
    system_cpu_usage?: number;
    cpu_usage?: { total_usage?: number };
  };
  memory_stats?: { usage?: number };
}

function readContainerStats(stats: DockerStatsSample): { cpu: number; memoryMb: number } {
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
    (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta =
    (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
  const online =
    stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  const cpu =
    systemDelta > 0 && cpuDelta >= 0
      ? Math.round((cpuDelta / systemDelta) * online * 1000) / 10
      : 0;
  const memoryMb = Math.round(((stats.memory_stats?.usage ?? 0) / (1024 * 1024)) * 10) / 10;
  return { cpu, memoryMb };
}
