import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface LocalDeployment {
  projectId: string;
  projectName: string;
  repoUrl: string;
  image?: string;
  port?: number | null;
  status: string;
  host?: string;
  url?: string;
  createdAt: string;
  buildLogs?: string;
  branch?: string;
}

export interface LocalDatabase {
  id: string;
  name: string;
  type: string;
  status: string;
  dbName: string;
  dbUser?: string;
  pooledUrl: string;
  directUrl: string;
  databaseUrl?: string;
  DATABASE_URL?: string;
  host: string;
  port: number;
  projectId?: string | null;
  createdAt: string;
  simulated?: boolean;
}

interface StoreShape {
  deployments: LocalDeployment[];
  databases: LocalDatabase[];
  logs: Record<string, string[]>;
}

function resolveDbPath(): string {
  const raw = (process.env.DATABASE_URL || "file:./dev.db").trim();
  if (raw.startsWith("file:")) {
    const relative = raw.slice("file:".length);
    return path.resolve(process.cwd(), relative);
  }
  // Si apunta a Postgres u otro motor, usamos un archivo local de respaldo.
  return path.resolve(process.cwd(), "dev.db");
}

function ensureStore(): StoreShape {
  const filePath = resolveDbPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    const empty: StoreShape = { deployments: [], databases: [], logs: {} };
    fs.writeFileSync(filePath, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoreShape;
    return {
      deployments: Array.isArray(parsed.deployments) ? parsed.deployments : [],
      databases: Array.isArray(parsed.databases) ? parsed.databases : [],
      logs: parsed.logs && typeof parsed.logs === "object" ? parsed.logs : {},
    };
  } catch {
    const empty: StoreShape = { deployments: [], databases: [], logs: {} };
    fs.writeFileSync(filePath, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

function saveStore(store: StoreShape): void {
  const filePath = resolveDbPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

export function isSqliteUrl(url = process.env.DATABASE_URL): boolean {
  return !url || url.trim().startsWith("file:");
}

export function listDeployments(): LocalDeployment[] {
  return ensureStore().deployments.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function listDatabases(): LocalDatabase[] {
  return ensureStore().databases.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function createDeployment(input: {
  repoUrl: string;
  projectName: string;
  branch?: string;
  clearCache?: boolean;
}): { projectId: string; jobId: string; status: string } {
  const store = ensureStore();
  const projectId = randomBytes(8).toString("hex");
  const createdAt = new Date().toISOString();
  const row: LocalDeployment = {
    projectId,
    projectName: input.projectName,
    repoUrl: input.repoUrl,
    image: input.projectName,
    port: null,
    status: "queued",
    host: `${input.projectName}.local`,
    url: "",
    createdAt,
    branch: input.branch ?? "main",
    buildLogs: [
      "Modo local: sin Docker Desktop / motor remoto.",
      `Cola simulada para ${input.projectName} (${input.branch ?? "main"}).`,
      input.clearCache ? "clearCache solicitado (simulado)." : "",
      "Estado: queued → building → running (simulado).",
    ]
      .filter(Boolean)
      .join("\n"),
  };
  store.deployments.unshift(row);
  const logLines = (row.buildLogs ?? "").split("\n").filter(Boolean);
  store.logs[projectId] = logLines;
  // Simula progreso en memoria persistida
  row.status = "running";
  store.logs[projectId].push("Simulación: contenedor marcado como running.");
  row.buildLogs = store.logs[projectId].join("\n");
  saveStore(store);
  return { projectId, jobId: projectId, status: "queued" };
}

export function createDatabase(input: {
  name: string;
  type?: string;
}): LocalDatabase {
  const store = ensureStore();
  const type = input.type ?? "postgres";
  const id = randomBytes(8).toString("hex");
  const port = type === "mysql" ? 3306 : type === "redis" ? 6379 : 5432;
  const user = "local";
  const pass = randomBytes(8).toString("hex");
  const dbName = input.name.replace(/[^a-z0-9_]+/gi, "_").toLowerCase() || "app";
  const host = `local-${type}`;
  const databaseUrl =
    type === "redis"
      ? `redis://:${pass}@${host}:${port}/0`
      : type === "mysql"
        ? `mysql://${user}:${pass}@${host}:${port}/${dbName}`
        : `postgresql://${user}:${pass}@${host}:${port}/${dbName}?schema=public`;

  const row: LocalDatabase = {
    id,
    name: input.name,
    type,
    status: "simulated",
    dbName,
    dbUser: user,
    host,
    port,
    pooledUrl: databaseUrl,
    directUrl: databaseUrl,
    databaseUrl,
    DATABASE_URL: databaseUrl,
    projectId: null,
    createdAt: new Date().toISOString(),
    simulated: true,
  };
  store.databases.unshift(row);
  saveStore(store);
  return row;
}

export function getLogs(projectId: string): string[] {
  const store = ensureStore();
  return store.logs[projectId] ?? [
    "Modo local: no hay motor Docker/API disponible.",
    "Los logs reales aparecerán cuando API_URL apunte a un motor en línea.",
  ];
}

export function redeploy(projectId: string): {
  projectId: string;
  status: string;
} | null {
  const store = ensureStore();
  const source = store.deployments.find((item) => item.projectId === projectId);
  if (!source) {
    return null;
  }
  return createDeployment({
    repoUrl: source.repoUrl,
    projectName: source.projectName,
    branch: source.branch,
  });
}
