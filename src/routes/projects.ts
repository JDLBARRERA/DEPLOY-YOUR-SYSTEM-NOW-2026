import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/requireAdmin.js";
import { prisma } from "../db.js";
import { parseMemoryBytes, normalizeImageName } from "../services/DeployEngine.js";
import { appHost } from "../services/appHost.js";
import { CaddyClient } from "../services/CaddyClient.js";
import { normalizeCustomDomain } from "../services/customDomain.js";
import {
  listProjectVariables,
  createProjectVariable,
  updateProjectVariable,
  deleteProjectVariable,
  normalizeEnvPair,
} from "../services/projectEnv.js";
import type { DeploymentStore } from "../services/DeploymentStore.js";
import {
  DatabaseAddonError,
  DatabaseAddonService,
  type AddonType,
} from "../services/DatabaseAddonService.js";
const execAsync = promisify(exec);
const MEMORY_LIMIT = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)$/i;
const APP_CONTAINER_REF = /^paas-[a-f0-9]{16}$/;
const DOCKER_ID_REF = /^[a-f0-9]{12,64}$/;
const STATS_FORMAT =
  `'{"cpu":"{{.CPUPerc}}","ram":"{{.MemUsage}}","net":"{{.NetIO}}","disk":"{{.BlockIO}}"}'`;

interface ProjectMetrics {
  active: boolean;
  cpu: number;
  ramUsed: number;
  ramLimit: number;
  net: string;
  disk: string;
}

const updateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    memoryLimit: { type: "string", minLength: 2, maxLength: 16 },
    cpuLimit: { type: "number", minimum: 0.05, maximum: 16 },
    githubToken: { type: "string", maxLength: 300 },
    customDomain: { type: "string", maxLength: 253 },
    serviceType: { type: "string", enum: ["web", "worker"] },
  },
} as const;

const projectSelect = {
  id: true,
  name: true,
  repoUrl: true,
  branch: true,
  memoryLimit: true,
  cpuLimit: true,
  githubToken: true,
  customDomain: true,
  serviceType: true,
} as const;

function publicProject<T extends { githubToken: string | null }>(
  project: T,
): Omit<T, "githubToken"> & { hasGithubToken: boolean } {
  const { githubToken, ...rest } = project;
  return { ...rest, hasGithubToken: Boolean(githubToken?.trim()) };
}

function validToken(value: string): boolean {
  return value.length > 0 && value.length <= 300 && !/[\s@]/.test(value);
}

function validMemory(value: string): boolean {
  const trimmed = value.trim();
  if (!MEMORY_LIMIT.test(trimmed)) {
    return false;
  }
  return parseMemoryBytes(trimmed) > 0;
}

function prismaCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
}

const APP_CONTAINER_NAME = /^paas-([a-f0-9]{16})$/;

function inactiveMetrics(): ProjectMetrics {
  return { active: false, cpu: 0, ramUsed: 0, ramLimit: 0, net: "0B / 0B", disk: "0B / 0B" };
}

async function activeContainer(projectId: string, projectName: string): Promise<string | null> {
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, status: "running", containerId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { containerId: true },
  });
  const containerId = deployment?.containerId?.trim() ?? "";
  if (DOCKER_ID_REF.test(containerId) && (await containerIsRunning(containerId))) {
    return containerId;
  }
  let image = "";
  try {
    image = normalizeImageName(projectName);
  } catch {
    return null;
  }
  return runningContainerForImage(image);
}

async function containerIsRunning(ref: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" "${ref}"`, {
      timeout: 3000,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

function runningContainerForImage(image: string): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(image)) {
    return null;
  }
  let listed = "";
  try {
    listed = execSync(`docker ps --filter status=running --format "{{.Names}}"`, {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 3000,
    });
  } catch {
    return null;
  }
  for (const name of listed.split(/\s+/).filter(Boolean)) {
    if (!APP_CONTAINER_REF.test(name)) {
      continue;
    }
    let inspected = "";
    try {
      inspected = execSync(
        `docker inspect -f '{{.Config.Image}}|{{index .Config.Labels "paas.app"}}' "${name}"`,
        { stdio: "pipe", encoding: "utf8", timeout: 3000 },
      ).trim();
    } catch {
      continue;
    }
    const [configured = "", label = ""] = inspected.split("|");
    if (label === image || configured === image || configured.split(":")[0] === image) {
      return name;
    }
  }
  return null;
}

async function readDockerStats(ref: string): Promise<ProjectMetrics> {
  if (!APP_CONTAINER_REF.test(ref) && !DOCKER_ID_REF.test(ref)) {
    return inactiveMetrics();
  }
  const { stdout } = await execAsync(
    `docker stats --no-stream --format ${STATS_FORMAT} "${ref}"`,
    { timeout: 3000 },
  );
  const parsed = JSON.parse(stdout.trim()) as {
    cpu?: string;
    ram?: string;
    net?: string;
    disk?: string;
  };
  const ram = (parsed.ram ?? "").split("/").map((part) => part.trim());
  return {
    active: true,
    cpu: parsePercent(parsed.cpu ?? ""),
    ramUsed: parseByteToken(ram[0] ?? ""),
    ramLimit: parseByteToken(ram[1] ?? ""),
    net: parsed.net?.trim() || "0B / 0B",
    disk: parsed.disk?.trim() || "0B / 0B",
  };
}

function parsePercent(value: string): number {
  const amount = Number.parseFloat(value.replace("%", "").trim());
  return Number.isFinite(amount) ? amount : 0;
}

function parseByteToken(value: string): number {
  const match = /^([\d.]+)\s*([a-z]+)?$/i.exec(value.trim());
  if (!match) {
    return 0;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  const unit = (match[2] ?? "b").toLowerCase();
  const powers: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
  };
  return Math.round(amount * (powers[unit] ?? 1));
}

async function retireProjectApps(projectName: string, store?: DeploymentStore): Promise<void> {
  let image: string;
  try {
    image = normalizeImageName(projectName);
  } catch {
    return;
  }

  let listed = "";
  try {
    listed = execSync(`docker ps -a --format "{{.Names}}"`, {
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch {
    listed = "";
  }

  const ids = new Set<string>();
  for (const name of listed.split(/\s+/).filter(Boolean)) {
    const match = APP_CONTAINER_NAME.exec(name);
    if (!match) {
      continue;
    }
    let inspected = "";
    try {
      inspected = execSync(
        `docker inspect -f '{{.Config.Image}}|{{index .Config.Labels "paas.app"}}' "${name}"`,
        { stdio: "pipe", encoding: "utf8" },
      ).trim();
    } catch {
      continue;
    }
    const [configured = "", label = ""] = inspected.split("|");
    if (label === image || configured === image || configured.split(":")[0] === image) {
      ids.add(match[1]);
    }
  }

  if (store) {
    for (const record of await store.list()) {
      if (record.image === image && APP_CONTAINER_NAME.test(`paas-${record.projectId}`)) {
        ids.add(record.projectId);
      }
    }
  }

  const caddy = new CaddyClient();
  for (const id of ids) {
    const name = `paas-${id}`;
    try {
      execSync(`docker stop "${name}"`, { stdio: "pipe" });
    } catch {
      // Ya estaba detenido.
    }
    try {
      execSync(`docker rm "${name}"`, { stdio: "pipe" });
    } catch {
      // Ya no existe.
    }
    try {
      await caddy.deleteRoute(id);
    } catch {
      // La ruta ya no está.
    }
    await store?.update(id, { status: "replaced" });
  }
  try {
    await caddy.ensureCatchAll();
  } catch {
    // Caddy sigue con la ruta anterior si el admin no responde.
  }
}

async function refreshRunningRoute(
  store: DeploymentStore | undefined,
  projectName: string,
  customDomain: string | null,
): Promise<void> {
  if (!store) {
    return;
  }
  try {
    const host = appHost(normalizeImageName(projectName));
    const records = await store.list();
    const running = records.filter(
      (record) => record.status === "running" && record.host === host,
    );
    if (running.length === 0) {
      return;
    }
    const caddy = new CaddyClient();
    for (const record of running) {
      const port = Number(record.port) || 8000;
      await caddy.upsertRoute(
        record.projectId,
        host,
        `paas-${record.projectId}:${port}`,
        customDomain,
      );
    }
  } catch (error) {
    console.error(
      `No se actualizó la ruta Caddy de ${projectName}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function projectRoutes(
  app: FastifyInstance,
  store?: DeploymentStore,
): Promise<void> {
  app.get("/projects", { preValidation: requireAdmin }, async () => {
    const projects = await prisma.project.findMany({
      orderBy: { name: "asc" },
      select: projectSelect,
    });
    return projects.map(publicProject);
  });

  app.patch<{
    Params: { id: string };
    Body: {
      memoryLimit?: string;
      cpuLimit?: number;
      githubToken?: string;
      customDomain?: string;
      serviceType?: "web" | "worker";
    };
  }>(
    "/projects/:id",
    { schema: { body: updateSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      const memoryLimit = request.body.memoryLimit?.trim();
      const cpuLimit = request.body.cpuLimit;
      const githubToken =
        request.body.githubToken === undefined
          ? undefined
          : request.body.githubToken.trim();
      let customDomain: string | null | undefined;
      if (request.body.customDomain === undefined) {
        customDomain = undefined;
      } else if (request.body.customDomain.trim().length === 0) {
        customDomain = null;
      } else {
        try {
          customDomain = normalizeCustomDomain(request.body.customDomain);
        } catch (error) {
          return reply.code(400).send({
            error: error instanceof Error ? error.message : "customDomain no es válido",
          });
        }
      }
      const serviceType =
        request.body.serviceType === undefined
          ? undefined
          : request.body.serviceType === "worker"
            ? "worker"
            : request.body.serviceType === "web"
              ? "web"
              : null;
      if (serviceType === null) {
        return reply.code(400).send({ error: "serviceType debe ser web o worker" });
      }
      if (memoryLimit !== undefined && !validMemory(memoryLimit)) {
        return reply.code(400).send({
          error: "memoryLimit debe ser una cantidad como 256m, 512m o 1g",
        });
      }
      if (
        cpuLimit !== undefined &&
        (!Number.isFinite(cpuLimit) || cpuLimit <= 0 || cpuLimit > 16)
      ) {
        return reply.code(400).send({
          error: "cpuLimit debe ser un número entre 0 y 16",
        });
      }
      if (githubToken !== undefined && githubToken.length > 0 && !validToken(githubToken)) {
        return reply.code(400).send({
          error: "githubToken no es un token válido",
        });
      }
      if (
        memoryLimit === undefined &&
        cpuLimit === undefined &&
        githubToken === undefined &&
        customDomain === undefined &&
        serviceType === undefined
      ) {
        return reply.code(400).send({ error: "No hay cambios para guardar" });
      }

      try {
        const updated = await prisma.project.update({
          where: { id: request.params.id },
          data: {
            ...(memoryLimit !== undefined ? { memoryLimit } : {}),
            ...(cpuLimit !== undefined ? { cpuLimit } : {}),
            ...(githubToken !== undefined ? { githubToken: githubToken || null } : {}),
            ...(customDomain !== undefined ? { customDomain } : {}),
            ...(serviceType !== undefined ? { serviceType } : {}),
          },
          select: projectSelect,
        });
        if (customDomain !== undefined) {
          await refreshRunningRoute(store, updated.name, updated.customDomain);
        }
        return publicProject(updated);
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          return reply.code(409).send({ error: "Ese dominio ya está asignado a otro proyecto" });
        }
        if (prismaCode(error) === "P2025") {
          return reply.code(404).send({ error: "Proyecto no encontrado" });
        }
        request.log.error(error);
        return reply.code(500).send({ error: "No se pudo actualizar el proyecto" });
      }
    },
  );

  const addons = new DatabaseAddonService();

  app.delete<{ Params: { id: string } }>(
    "/projects/:id",
    { preValidation: requireAdmin },
    async (request, reply) => {
      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true, addons: { select: { id: true } } },
      });
      if (!project) {
        return reply.code(404).send({ error: "Proyecto no encontrado" });
      }

      for (const addon of project.addons) {
        try {
          await addons.remove(project.id, addon.id);
        } catch (error) {
          request.log.error(
            { err: error instanceof Error ? error.message : error },
            "No se pudo retirar una base del proyecto",
          );
        }
      }

      try {
        await retireProjectApps(project.name, store);
      } catch (error) {
        request.log.error(
          { err: error instanceof Error ? error.message : error },
          "No se pudieron retirar los contenedores del proyecto",
        );
      }

      try {
        await prisma.deployment.deleteMany({ where: { projectId: project.id } });
        await prisma.project.delete({ where: { id: project.id } });
        return { ok: true };
      } catch (error) {
        if (prismaCode(error) === "P2025") {
          return reply.code(404).send({ error: "Proyecto no encontrado" });
        }
        request.log.error(error);
        return reply.code(500).send({ error: "No se pudo eliminar el proyecto" });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/projects/:id/metrics",
    { preValidation: requireAdmin },
    async (request, reply) => {
      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true },
      });
      if (!project) {
        return reply.code(404).send({ error: "Proyecto no encontrado" });
      }
      const ref = await activeContainer(project.id, project.name);
      if (!ref) {
        return inactiveMetrics();
      }
      try {
        return await readDockerStats(ref);
      } catch {
        return inactiveMetrics();
      }
    },
  );

  const addonCreateSchema = {
    type: "object",
    additionalProperties: false,
    required: ["type"],
    properties: {
      type: { type: "string", enum: ["postgres", "redis"] },
    },
  } as const;

  app.get<{ Params: { id: string } }>(
    "/projects/:id/addons",
    { preValidation: requireAdmin },
    async (request, reply) => {
      const rows = await addons.list(request.params.id);
      if (!rows) {
        return reply.code(404).send({ error: "Proyecto no encontrado" });
      }
      return rows;
    },
  );

  app.post<{ Params: { id: string }; Body: { type: AddonType } }>(
    "/projects/:id/addons",
    { schema: { body: addonCreateSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      try {
        const created = await addons.create(request.params.id, request.body.type);
        return reply.code(201).send(created);
      } catch (error) {
        if (error instanceof DatabaseAddonError && error.message === "Proyecto no encontrado") {
          return reply.code(404).send({ error: error.message });
        }
        const message =
          error instanceof DatabaseAddonError
            ? error.message
            : "No se pudo crear la base de datos";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.delete<{ Params: { id: string; addonId: string } }>(
    "/projects/:id/addons/:addonId",
    { preValidation: requireAdmin },
    async (request, reply) => {
      try {
        const removed = await addons.remove(request.params.id, request.params.addonId);
        if (!removed) {
          return reply.code(404).send({ error: "Base de datos no encontrada" });
        }
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof DatabaseAddonError
            ? error.message
            : "No se pudo eliminar la base de datos";
        return reply.code(400).send({ error: message });
      }
    },
  );

  const variableCreateSchema = {
    type: "object",
    additionalProperties: false,
    required: ["key", "value"],
    properties: {
      key: { type: "string", minLength: 1, maxLength: 128 },
      value: { type: "string", maxLength: 8000 },
    },
  } as const;

  app.get<{ Params: { id: string } }>(
    "/projects/:id/variables",
    { preValidation: requireAdmin },
    async (request, reply) => {
      const rows = await listProjectVariables(request.params.id);
      if (!rows) {
        return reply.code(404).send({ error: "Proyecto no encontrado" });
      }
      return rows;
    },
  );

  app.post<{ Params: { id: string }; Body: { key: string; value: string } }>(
    "/projects/:id/variables",
    { schema: { body: variableCreateSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      try {
        normalizeEnvPair(request.body.key, request.body.value);
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Variable inválida",
        });
      }
      try {
        const created = await createProjectVariable(
          request.params.id,
          request.body.key,
          request.body.value,
        );
        if (!created) {
          return reply.code(404).send({ error: "Proyecto no encontrado" });
        }
        return reply.code(201).send(created);
      } catch (error) {
        if (prismaCode(error) === "P2002") {
          return reply.code(409).send({ error: "Esa clave ya existe en el proyecto" });
        }
        return reply.code(500).send({ error: "No se pudo guardar la variable" });
      }
    },
  );

  const variableUpdateSchema = {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: {
      value: { type: "string", maxLength: 8000 },
    },
  } as const;

  app.patch<{ Params: { id: string; variableId: string }; Body: { value: string } }>(
    "/projects/:id/variables/:variableId",
    { schema: { body: variableUpdateSchema }, preValidation: requireAdmin },
    async (request, reply) => {
      try {
        const updated = await updateProjectVariable(
          request.params.id,
          request.params.variableId,
          request.body.value,
        );
        if (!updated) {
          return reply.code(404).send({ error: "Variable no encontrada" });
        }
        return updated;
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Variable inválida",
        });
      }
    },
  );

  app.delete<{ Params: { id: string; variableId: string } }>(
    "/projects/:id/variables/:variableId",
    { preValidation: requireAdmin },
    async (request, reply) => {
      const removed = await deleteProjectVariable(request.params.id, request.params.variableId);
      if (!removed) {
        return reply.code(404).send({ error: "Variable no encontrada" });
      }
      return { ok: true };
    },
  );
}
