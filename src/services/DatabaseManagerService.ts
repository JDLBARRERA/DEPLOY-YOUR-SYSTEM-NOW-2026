import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import pg from "pg";
import { prisma } from "../db.js";
import type { DatabaseInstance } from "../generated/prisma/index.js";

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const CONNECTION_LIMIT = 20;

export class DatabaseManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseManagerError";
  }
}

export interface DatabaseConnection {
  pooledUrl: string;
  directUrl: string;
}

export interface ManagedDatabase extends DatabaseConnection {
  id: string;
  name: string;
  dbName: string;
  dbUser: string;
  host: string;
  port: number;
  pooledPort: number;
  projectId: string | null;
  parentId: string | null;
  createdAt: Date;
}

function assertIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new DatabaseManagerError("El identificador de Postgres no es válido");
  }
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DatabaseManagerError("El secreto de Postgres no es válido");
  }
  return `'${value}'`;
}

function credentialsKey(): Buffer {
  const secret = process.env.DB_CREDENTIALS_KEY ?? "paas-local-dev-credentials-key";
  return scryptSync(secret, "paas-database-credentials", 32);
}

function encryptPassword(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialsKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(":");
}

function decryptPassword(payload: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new DatabaseManagerError("No se pudo leer la contraseña guardada");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialsKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function adminUrl(database: string): string {
  const configured = process.env.DATABASE_URL;
  if (!configured) {
    throw new DatabaseManagerError("DATABASE_URL no está configurada");
  }
  const url = new URL(configured);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin<T>(
  database: string,
  run: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl(database) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function slugIdentifier(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const suffix = randomBytes(3).toString("hex");
  const base = slug ? `db_${slug}_${suffix}` : `db_${suffix}`;
  return base.slice(0, 63);
}

function connectionUrls(
  dbUser: string,
  dbPassword: string,
  dbName: string,
  host: string,
  port: number,
  pooledPort: number,
): DatabaseConnection {
  const user = encodeURIComponent(dbUser);
  const pass = encodeURIComponent(dbPassword);
  return {
    pooledUrl: `postgresql://${user}:${pass}@${host}:${pooledPort}/${dbName}?pgbouncer=true`,
    directUrl: `postgresql://${user}:${pass}@${host}:${port}/${dbName}`,
  };
}

function present(instance: DatabaseInstance): ManagedDatabase {
  const password = decryptPassword(instance.dbPassword);
  return {
    id: instance.id,
    name: instance.name,
    dbName: instance.dbName,
    dbUser: instance.dbUser,
    host: instance.host,
    port: instance.port,
    pooledPort: instance.pooledPort,
    projectId: instance.projectId,
    parentId: instance.parentId,
    createdAt: instance.createdAt,
    ...connectionUrls(
      instance.dbUser,
      password,
      instance.dbName,
      instance.host,
      instance.port,
      instance.pooledPort,
    ),
  };
}

export class DatabaseManagerService {
  async ensurePoolerAuth(): Promise<void> {
    const password = process.env.PGBOUNCER_PASSWORD ?? "pgbouncer";
    const literal = quoteLiteral(password);

    await withAdmin("paas", async (client) => {
      await client.query(`
        DO $$
        BEGIN
          CREATE ROLE pgbouncer LOGIN PASSWORD ${literal};
        EXCEPTION
          WHEN duplicate_object OR unique_violation THEN
            NULL;
        END
        $$;
      `);
      await client.query(`ALTER ROLE pgbouncer WITH LOGIN PASSWORD ${literal}`);
      await client.query(`
        CREATE OR REPLACE FUNCTION public.user_lookup(i_username text, OUT uname text, OUT phash text)
        RETURNS record
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = pg_catalog
        AS $$
          SELECT usename::text, passwd::text
          FROM pg_shadow
          WHERE usename = i_username
        $$;
      `);
      await client.query(
        "REVOKE ALL ON FUNCTION public.user_lookup(text) FROM PUBLIC",
      );
      await client.query(
        "GRANT EXECUTE ON FUNCTION public.user_lookup(text) TO pgbouncer",
      );
      await client.query("GRANT CONNECT ON DATABASE paas TO pgbouncer");
    });
  }

  async createDatabase(name: string, projectId?: string): Promise<ManagedDatabase> {
    const label = name.trim();
    if (!label || label.length > 64) {
      throw new DatabaseManagerError("El nombre de la base debe tener entre 1 y 64 caracteres");
    }

    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new DatabaseManagerError("El proyecto no existe");
      }
    }

    const dbName = slugIdentifier(label);
    const dbUser = `usr_${randomBytes(4).toString("hex")}`;
    const dbPassword = randomBytes(18).toString("hex");
    const host = "127.0.0.1";

    await this.provisionRole(dbUser, dbPassword, dbName);
    if (projectId) {
      await this.detachOtherDatabase(projectId, "");
    }
    const instance = await prisma.databaseInstance.create({
      data: {
        name: label,
        dbName,
        dbUser,
        dbPassword: encryptPassword(dbPassword),
        host,
        port: 5432,
        pooledPort: 6543,
        projectId,
      },
    });

    if (projectId) {
      await this.writeProjectEnv(projectId, instance);
    }

    return present(instance);
  }

  async branchDatabase(
    parentDbName: string,
    newBranchName: string,
  ): Promise<ManagedDatabase> {
    const parent = await prisma.databaseInstance.findUnique({
      where: { dbName: parentDbName },
    });
    if (!parent) {
      throw new DatabaseManagerError("La base de origen no existe");
    }

    const label = newBranchName.trim();
    if (!label || label.length > 64) {
      throw new DatabaseManagerError("El nombre del branch debe tener entre 1 y 64 caracteres");
    }

    const dbName = slugIdentifier(label);
    const dbUser = `usr_${randomBytes(4).toString("hex")}`;
    const dbPassword = randomBytes(18).toString("hex");
    const nextIdent = assertIdentifier(dbName);
    const userIdent = assertIdentifier(dbUser);
    const parentUser = assertIdentifier(parent.dbUser);

    await withAdmin("paas", async (client) => {
      await client.query(
        `CREATE USER ${userIdent} WITH PASSWORD ${quoteLiteral(dbPassword)} CONNECTION LIMIT ${CONNECTION_LIMIT}`,
      );
      await client.query(
        `ALTER ROLE ${userIdent} SET statement_timeout = '30s'`,
      );
      await this.cloneDatabase(client, parent.dbName, nextIdent, userIdent);
      await client.query(`REVOKE ALL ON DATABASE ${nextIdent} FROM PUBLIC`);
      await client.query(
        `GRANT ALL PRIVILEGES ON DATABASE ${nextIdent} TO ${userIdent}`,
      );
    });

    await withAdmin(dbName, async (client) => {
      await client.query(`REASSIGN OWNED BY ${parentUser} TO ${userIdent}`);
      await client.query(`ALTER SCHEMA public OWNER TO ${userIdent}`);
      await client.query(`GRANT ALL ON SCHEMA public TO ${userIdent}`);
    });

    const instance = await prisma.databaseInstance.create({
      data: {
        name: label,
        dbName,
        dbUser,
        dbPassword: encryptPassword(dbPassword),
        host: parent.host,
        port: parent.port,
        pooledPort: parent.pooledPort,
        parentId: parent.id,
      },
    });

    return present(instance);
  }

  async linkDatabase(id: string, projectId: string): Promise<ManagedDatabase> {
    const instance = await prisma.databaseInstance.findUnique({ where: { id } });
    if (!instance) {
      throw new DatabaseManagerError("La base de datos no existe");
    }
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new DatabaseManagerError("El proyecto no existe");
    }

    if (instance.projectId && instance.projectId !== projectId) {
      await this.clearDatabaseEnv(instance.projectId);
    }
    await this.detachOtherDatabase(projectId, instance.id);

    const updated = await prisma.databaseInstance.update({
      where: { id },
      data: { projectId },
    });
    await this.writeProjectEnv(projectId, updated);
    return present(updated);
  }

  async previewDatabaseEnv(
    parentDbName: string,
    branch: string,
  ): Promise<Record<string, string>> {
    const parent = await prisma.databaseInstance.findUnique({
      where: { dbName: parentDbName },
    });
    if (!parent) {
      throw new DatabaseManagerError("La base de origen no existe");
    }

    const label = `preview/${branch}`.slice(0, 64);
    const existing = await prisma.databaseInstance.findFirst({
      where: { parentId: parent.id, name: label },
    });
    const database = existing ? present(existing) : await this.branchDatabase(parent.dbName, label);
    return {
      DATABASE_URL: database.pooledUrl.replace(
        `@${database.host}:${database.pooledPort}/`,
        `@pgbouncer:${database.pooledPort}/`,
      ),
      DIRECT_URL: database.directUrl.replace(
        `@${database.host}:${database.port}/`,
        `@postgres:${database.port}/`,
      ),
    };
  }

  async listDatabases(): Promise<ManagedDatabase[]> {
    const rows = await prisma.databaseInstance.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map(present);
  }

  private async provisionRole(
    dbUser: string,
    dbPassword: string,
    dbName: string,
  ): Promise<void> {
    const userIdent = assertIdentifier(dbUser);
    const dbIdent = assertIdentifier(dbName);

    await withAdmin("paas", async (client) => {
      await client.query(
        `CREATE USER ${userIdent} WITH PASSWORD ${quoteLiteral(dbPassword)} CONNECTION LIMIT ${CONNECTION_LIMIT}`,
      );
      await client.query(
        `ALTER ROLE ${userIdent} SET statement_timeout = '30s'`,
      );
      await client.query(`CREATE DATABASE ${dbIdent} OWNER ${userIdent}`);
      await client.query(`REVOKE ALL ON DATABASE ${dbIdent} FROM PUBLIC`);
      await client.query(
        `GRANT ALL PRIVILEGES ON DATABASE ${dbIdent} TO ${userIdent}`,
      );
    });

    await withAdmin(dbName, async (client) => {
      await client.query(`ALTER SCHEMA public OWNER TO ${userIdent}`);
      await client.query(`GRANT ALL ON SCHEMA public TO ${userIdent}`);
    });
  }

  private async cloneDatabase(
    client: pg.Client,
    parentName: string,
    nextIdent: string,
    userIdent: string,
  ): Promise<void> {
    const parentIdent = assertIdentifier(parentName);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await client.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [parentName],
      );
      try {
        await client.query(
          `CREATE DATABASE ${nextIdent} TEMPLATE ${parentIdent} OWNER ${userIdent}`,
        );
        return;
      } catch (error) {
        lastError = error;
      }
    }
    const message = lastError instanceof Error ? lastError.message : "clone failed";
    throw new DatabaseManagerError(`No se pudo clonar la base: ${message}`);
  }

  private async writeProjectEnv(
    projectId: string,
    instance: DatabaseInstance,
  ): Promise<void> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new DatabaseManagerError("El proyecto no existe");
    }

    const password = decryptPassword(instance.dbPassword);
    const runtime = connectionUrls(
      instance.dbUser,
      password,
      instance.dbName,
      "pgbouncer",
      instance.port,
      instance.pooledPort,
    );
    const direct = connectionUrls(
      instance.dbUser,
      password,
      instance.dbName,
      "postgres",
      instance.port,
      instance.pooledPort,
    );

    await upsertDatabaseEnv(projectId, "DATABASE_URL", runtime.pooledUrl);
    await upsertDatabaseEnv(projectId, "DIRECT_URL", direct.directUrl);
  }

  private async detachOtherDatabase(projectId: string, keepId: string): Promise<void> {
    const existing = await prisma.databaseInstance.findUnique({ where: { projectId } });
    if (!existing || existing.id === keepId) {
      return;
    }
    await prisma.databaseInstance.update({
      where: { id: existing.id },
      data: { projectId: null },
    });
  }

  private async clearDatabaseEnv(projectId: string): Promise<void> {
    await prisma.envVar.deleteMany({
      where: {
        projectId,
        environment: "ALL",
        key: { in: ["DATABASE_URL", "DIRECT_URL"] },
      },
    });
  }
}

async function upsertDatabaseEnv(
  projectId: string,
  key: string,
  value: string,
): Promise<void> {
  await prisma.envVar.upsert({
    where: {
      projectId_key_environment: {
        projectId,
        key,
        environment: "ALL",
      },
    },
    create: {
      projectId,
      key,
      value,
      environment: "ALL",
    },
    update: { value },
  });
}
