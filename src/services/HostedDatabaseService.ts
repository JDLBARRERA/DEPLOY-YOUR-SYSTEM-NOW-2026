import { exec } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "../db.js";

const execAsync = promisify(exec);
const DOCKER_TIMEOUT_MS = 20_000;
const CONTAINER_NAME = /^paas-db-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HostedDatabaseType = "POSTGRES" | "REDIS";

export class HostedDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostedDatabaseError";
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

function containerName(id: string): string {
  return `paas-db-${id}`;
}

async function removeContainer(name: string): Promise<void> {
  if (!CONTAINER_NAME.test(name)) {
    return;
  }
  try {
    await execAsync(`docker rm -f ${shellQuote(name)}`, { timeout: DOCKER_TIMEOUT_MS });
  } catch {
    // El contenedor ya no está.
  }
}

export async function createHostedDatabase(name: string, type: HostedDatabaseType) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new HostedDatabaseError("Nombre no válido");
  }

  const id = randomUUID();
  const nameOnDocker = containerName(id);
  const user = `usr_${randomBytes(3).toString("hex")}`;
  const password = randomBytes(18).toString("hex");
  const database = `db_${randomBytes(3).toString("hex")}`;
  const network = deployNetwork();
  const connectionString =
    type === "POSTGRES"
      ? `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${nameOnDocker}:5432/${database}`
      : `redis://:${encodeURIComponent(password)}@${nameOnDocker}:6379/0`;

  const command =
    type === "POSTGRES"
      ? [
          "docker run -d",
          `--name ${shellQuote(nameOnDocker)}`,
          `--network ${shellQuote(network)}`,
          "--restart=always",
          `-e POSTGRES_USER=${shellQuote(user)}`,
          `-e POSTGRES_PASSWORD=${shellQuote(password)}`,
          `-e POSTGRES_DB=${shellQuote(database)}`,
          "postgres:15-alpine",
        ].join(" ")
      : [
          "docker run -d",
          `--name ${shellQuote(nameOnDocker)}`,
          `--network ${shellQuote(network)}`,
          "--restart=always",
          "redis:7-alpine",
          "redis-server",
          "--requirepass",
          shellQuote(password),
        ].join(" ");

  try {
    await execAsync(command, { timeout: DOCKER_TIMEOUT_MS });
  } catch {
    await removeContainer(nameOnDocker);
    throw new HostedDatabaseError("No se pudo crear la base de datos");
  }

  try {
    return await prisma.database.create({
      data: {
        id,
        name: trimmed,
        type,
        connectionString,
        status: "running",
      },
    });
  } catch {
    await removeContainer(nameOnDocker);
    throw new HostedDatabaseError("No se pudo guardar la base de datos");
  }
}

export async function listHostedDatabases() {
  const rows = await prisma.database.findMany({ orderBy: { createdAt: "desc" } });
  const alive = [];
  for (const row of rows) {
    const presence = await hostedContainerPresence(containerName(row.id));
    if (presence === "missing") {
      await prisma.database.deleteMany({ where: { id: row.id } });
      continue;
    }
    alive.push(row);
  }
  return alive;
}

async function hostedContainerPresence(
  name: string,
): Promise<"present" | "missing" | "unknown"> {
  if (!CONTAINER_NAME.test(name)) {
    return "unknown";
  }
  try {
    await execAsync(`docker inspect ${shellQuote(name)}`, { timeout: 2000 });
    return "present";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    if (/No such (object|container)/i.test(`${detail}\n${stderr}`)) {
      return "missing";
    }
    return "unknown";
  }
}

export async function deleteHostedDatabase(id: string): Promise<void> {
  await removeContainer(containerName(id));
  await prisma.database.deleteMany({ where: { id } });
}
