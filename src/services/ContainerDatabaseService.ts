import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

export type DatabaseEngine = "postgres" | "mysql" | "redis";

export interface ContainerDatabaseRecord {
  id: string;
  name: string;
  type: DatabaseEngine;
  status: "running" | "stopped" | "failed" | string;
  dbName: string;
  dbUser: string;
  host: string;
  port: number;
  containerName: string;
  databaseUrl: string;
  pooledUrl: string;
  directUrl: string;
  projectId: string | null;
  createdAt: string;
}

const INDEX_KEY = "paas:databases";
const NETWORK = "mi-paas_default";
const NAME_OK = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

export class ContainerDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContainerDatabaseError";
  }
}

function recordKey(id: string): string {
  return `paas:database:${id}`;
}

function slug(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || "db";
}

function encodeSecret(value: string): string {
  return encodeURIComponent(value);
}

export class ContainerDatabaseService {
  constructor(private readonly redis: Redis) {}

  async list(): Promise<ContainerDatabaseRecord[]> {
    const ids = await this.redis.smembers(INDEX_KEY);
    const rows = await Promise.all(ids.map((id) => this.get(id)));
    const present = rows.filter((row): row is ContainerDatabaseRecord => row !== null);
    await Promise.all(present.map((row) => this.refreshStatus(row)));
    return present.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<ContainerDatabaseRecord | null> {
    const data = await this.redis.hgetall(recordKey(id));
    if (!data.id) {
      return null;
    }
    return {
      id: data.id,
      name: data.name,
      type: data.type as DatabaseEngine,
      status: data.status,
      dbName: data.dbName,
      dbUser: data.dbUser,
      host: data.host,
      port: Number(data.port),
      containerName: data.containerName,
      databaseUrl: data.databaseUrl,
      pooledUrl: data.pooledUrl,
      directUrl: data.directUrl,
      projectId: data.projectId ? data.projectId : null,
      createdAt: data.createdAt,
    };
  }

  async create(name: string, type: DatabaseEngine): Promise<ContainerDatabaseRecord> {
    const label = name.trim();
    if (!label || label.length > 64) {
      throw new ContainerDatabaseError("El nombre debe tener entre 1 y 64 caracteres");
    }
    if (!["postgres", "mysql", "redis"].includes(type)) {
      throw new ContainerDatabaseError("type debe ser postgres, mysql o redis");
    }

    const id = randomBytes(8).toString("hex");
    const short = slug(label);
    const containerName = `paas-db-${type}-${short}-${id.slice(0, 6)}`;
    if (!NAME_OK.test(containerName)) {
      throw new ContainerDatabaseError("Nombre de contenedor inválido");
    }

    const password = randomBytes(18).toString("hex");
    const dbUser = type === "redis" ? "default" : `usr_${randomBytes(3).toString("hex")}`;
    const dbName = type === "redis" ? "0" : `db_${randomBytes(3).toString("hex")}`;
    const port =
      type === "postgres" ? 5432 : type === "mysql" ? 3306 : 6379;

    this.ensureNetwork();

    try {
      this.runContainer(type, containerName, dbUser, password, dbName);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "docker run failed";
      throw new ContainerDatabaseError(`No se pudo levantar el contenedor: ${detail}`);
    }

    const databaseUrl = this.buildUrl(type, dbUser, password, containerName, port, dbName);
    const record: ContainerDatabaseRecord = {
      id,
      name: label,
      type,
      status: "running",
      dbName,
      dbUser,
      host: containerName,
      port,
      containerName,
      databaseUrl,
      pooledUrl: databaseUrl,
      directUrl: databaseUrl,
      projectId: null,
      createdAt: new Date().toISOString(),
    };

    await this.save(record);
    await this.redis.sadd(INDEX_KEY, id);
    await this.refreshStatus(record);
    return record;
  }

  private async save(record: ContainerDatabaseRecord): Promise<void> {
    const payload: Record<string, string> = {
      id: record.id,
      name: record.name,
      type: record.type,
      status: record.status,
      dbName: record.dbName,
      dbUser: record.dbUser,
      host: record.host,
      port: String(record.port),
      containerName: record.containerName,
      databaseUrl: record.databaseUrl,
      pooledUrl: record.pooledUrl,
      directUrl: record.directUrl,
      projectId: record.projectId ?? "",
      createdAt: record.createdAt,
    };
    await this.redis.hset(recordKey(record.id), payload);
  }

  private ensureNetwork(): void {
    try {
      execSync(`docker network create "${NETWORK}"`, { stdio: "pipe" });
    } catch {
      // Ya existe.
    }
  }

  private runContainer(
    type: DatabaseEngine,
    containerName: string,
    dbUser: string,
    password: string,
    dbName: string,
  ): void {
    if (type === "postgres") {
      execSync(
        [
          "docker run -d",
          `--name "${containerName}"`,
          `--network "${NETWORK}"`,
          `-e POSTGRES_USER="${dbUser}"`,
          `-e POSTGRES_PASSWORD="${password}"`,
          `-e POSTGRES_DB="${dbName}"`,
          "postgres:16-alpine",
        ].join(" "),
        { stdio: "pipe", encoding: "utf8" },
      );
      return;
    }

    if (type === "mysql") {
      execSync(
        [
          "docker run -d",
          `--name "${containerName}"`,
          `--network "${NETWORK}"`,
          `-e MYSQL_ROOT_PASSWORD="${password}"`,
          `-e MYSQL_DATABASE="${dbName}"`,
          `-e MYSQL_USER="${dbUser}"`,
          `-e MYSQL_PASSWORD="${password}"`,
          "mysql:8.4",
        ].join(" "),
        { stdio: "pipe", encoding: "utf8" },
      );
      return;
    }

    execSync(
      [
        "docker run -d",
        `--name "${containerName}"`,
        `--network "${NETWORK}"`,
        "redis:7-alpine",
        `redis-server --requirepass "${password}"`,
      ].join(" "),
      { stdio: "pipe", encoding: "utf8" },
    );
  }

  private buildUrl(
    type: DatabaseEngine,
    dbUser: string,
    password: string,
    host: string,
    port: number,
    dbName: string,
  ): string {
    const user = encodeSecret(dbUser);
    const pass = encodeSecret(password);
    if (type === "postgres") {
      return `postgresql://${user}:${pass}@${host}:${port}/${dbName}?schema=public`;
    }
    if (type === "mysql") {
      return `mysql://${user}:${pass}@${host}:${port}/${dbName}`;
    }
    return `redis://:${pass}@${host}:${port}/0`;
  }

  private async refreshStatus(record: ContainerDatabaseRecord): Promise<void> {
    try {
      const running = execSync(
        `docker inspect --format="{{.State.Running}}" "${record.containerName}"`,
        { stdio: "pipe", encoding: "utf8" },
      ).trim();
      record.status = running === "true" ? "running" : "stopped";
    } catch {
      record.status = "failed";
    }
    await this.redis.hset(recordKey(record.id), {
      status: record.status,
    });
  }
}
