import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";

export type AddonType = "postgres" | "redis";

export interface DatabaseAddonView {
  id: string;
  projectId: string;
  type: string;
  containerName: string;
  connectionString: string;
}

const addonSelect = {
  id: true,
  projectId: true,
  type: true,
  containerName: true,
  connectionString: true,
} as const;

export class DatabaseAddonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseAddonError";
  }
}

function deployNetwork(): string {
  const fromEnv = process.env.DEPLOY_NETWORK?.trim();
  if (fromEnv && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(fromEnv)) {
    return fromEnv;
  }
  return "mi-paas_default";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function docker(command: string): void {
  execSync(command, { stdio: "pipe" });
}

function assertDocker(): void {
  try {
    docker("docker info");
  } catch {
    throw new DatabaseAddonError("Docker no está disponible");
  }
}

function ensureNetwork(network: string): void {
  try {
    docker(`docker network create ${shellQuote(network)}`);
  } catch {
    // La red ya existe.
  }
}

function removeContainer(name: string): void {
  try {
    docker(`docker rm -f ${shellQuote(name)}`);
  } catch {
    // El contenedor ya no está.
  }
}

function removeVolume(name: string): void {
  try {
    docker(`docker volume rm ${shellQuote(name)}`);
  } catch {
    // El volumen ya no está o sigue en uso.
  }
}

export class DatabaseAddonService {
  async list(projectId: string): Promise<DatabaseAddonView[] | null> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      return null;
    }
    return prisma.databaseAddon.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
      select: addonSelect,
    });
  }

  async create(projectId: string, type: AddonType): Promise<DatabaseAddonView> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new DatabaseAddonError("Proyecto no encontrado");
    }

    assertDocker();
    const suffix = randomBytes(4).toString("hex");
    const containerName = type === "postgres" ? `paas-pg-${suffix}` : `paas-redis-${suffix}`;
    const password = randomBytes(18).toString("hex");
    const network = deployNetwork();
    ensureNetwork(network);

    try {
      docker(`docker volume create ${shellQuote(containerName)}`);
      if (type === "postgres") {
        const user = `usr_${randomBytes(3).toString("hex")}`;
        const database = `db_${randomBytes(3).toString("hex")}`;
        docker(
          [
            "docker run -d",
            `--name ${shellQuote(containerName)}`,
            `--network ${shellQuote(network)}`,
            "--restart unless-stopped",
            `-v ${shellQuote(`${containerName}:/var/lib/postgresql/data`)}`,
            `-e POSTGRES_USER=${shellQuote(user)}`,
            `-e POSTGRES_PASSWORD=${shellQuote(password)}`,
            `-e POSTGRES_DB=${shellQuote(database)}`,
            "postgres:15-alpine",
          ].join(" "),
        );
        const connectionString = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${containerName}:5432/${database}`;
        return await this.persist(projectId, type, containerName, connectionString);
      }

      docker(
        [
          "docker run -d",
          `--name ${shellQuote(containerName)}`,
          `--network ${shellQuote(network)}`,
          "--restart unless-stopped",
          `-v ${shellQuote(`${containerName}:/data`)}`,
          "redis:7-alpine",
          "redis-server",
          "--requirepass",
          shellQuote(password),
        ].join(" "),
      );
      const connectionString = `redis://:${encodeURIComponent(password)}@${containerName}:6379/0`;
      return await this.persist(projectId, type, containerName, connectionString);
    } catch (error) {
      removeContainer(containerName);
      removeVolume(containerName);
      if (error instanceof DatabaseAddonError) {
        throw error;
      }
      throw new DatabaseAddonError("No se pudo crear la base de datos");
    }
  }

  async remove(projectId: string, addonId: string): Promise<boolean> {
    const addon = await prisma.databaseAddon.findFirst({
      where: { id: addonId, projectId },
      select: { id: true, containerName: true },
    });
    if (!addon) {
      return false;
    }
    if (!/^paas-(pg|redis)-[a-f0-9]{8}$/.test(addon.containerName)) {
      throw new DatabaseAddonError("Nombre de contenedor inválido");
    }
    assertDocker();
    removeContainer(addon.containerName);
    removeVolume(addon.containerName);
    await prisma.databaseAddon.delete({ where: { id: addon.id } });
    return true;
  }

  private async persist(
    projectId: string,
    type: AddonType,
    containerName: string,
    connectionString: string,
  ): Promise<DatabaseAddonView> {
    try {
      return await prisma.databaseAddon.create({
        data: { projectId, type, containerName, connectionString },
        select: addonSelect,
      });
    } catch (error) {
      removeContainer(containerName);
      removeVolume(containerName);
      throw error;
    }
  }
}
