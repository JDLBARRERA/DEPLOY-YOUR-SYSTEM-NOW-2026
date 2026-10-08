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

export interface EnvPair {
  key: string;
  value: string;
}

export interface PanelSettings {
  githubPat: string;
  adminPassword: string;
  domain: string;
  dropletIp: string;
  caddySslEnabled: boolean;
  caddyStatus: "active" | "inactive" | "unknown";
  globalEnv: EnvPair[];
  updatedAt: string;
}

interface StoreShape {
  deployments: LocalDeployment[];
  databases: LocalDatabase[];
  logs: Record<string, string[]>;
  settings?: PanelSettings;
}

const DEFAULT_SETTINGS = (): PanelSettings => ({
  githubPat: (process.env.GITHUB_PAT || "").trim(),
  adminPassword: (process.env.ADMIN_PASSWORD || "").trim(),
  domain: "deplowe-now.com",
  dropletIp: (() => {
    const api = (process.env.API_URL || "").trim();
    try {
      if (api) return new URL(api).hostname;
    } catch {
      // ignore
    }
    return "46.101.84.190";
  })(),
  caddySslEnabled: true,
  caddyStatus: "unknown",
  globalEnv: [],
  updatedAt: new Date().toISOString(),
});

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
      settings: parsed.settings,
    };
  } catch {
    const empty: StoreShape = { deployments: [], databases: [], logs: {} };
    fs.writeFileSync(filePath, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

function normalizeSettings(raw?: PanelSettings): PanelSettings {
  const defaults = DEFAULT_SETTINGS();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const globalEnv = Array.isArray(raw.globalEnv)
    ? raw.globalEnv
        .filter(
          (pair): pair is EnvPair =>
            !!pair &&
            typeof pair.key === "string" &&
            typeof pair.value === "string",
        )
        .map((pair) => ({ key: pair.key.trim(), value: pair.value }))
        .filter((pair) => pair.key.length > 0)
    : [];
  return {
    githubPat:
      typeof raw.githubPat === "string" ? raw.githubPat : defaults.githubPat,
    adminPassword:
      typeof raw.adminPassword === "string"
        ? raw.adminPassword
        : defaults.adminPassword,
    domain:
      typeof raw.domain === "string" && raw.domain.trim()
        ? raw.domain.trim()
        : defaults.domain,
    dropletIp:
      typeof raw.dropletIp === "string" && raw.dropletIp.trim()
        ? raw.dropletIp.trim()
        : defaults.dropletIp,
    caddySslEnabled:
      typeof raw.caddySslEnabled === "boolean"
        ? raw.caddySslEnabled
        : defaults.caddySslEnabled,
    caddyStatus:
      raw.caddyStatus === "active" ||
      raw.caddyStatus === "inactive" ||
      raw.caddyStatus === "unknown"
        ? raw.caddyStatus
        : defaults.caddyStatus,
    globalEnv,
    updatedAt:
      typeof raw.updatedAt === "string" ? raw.updatedAt : defaults.updatedAt,
  };
}

function quoteEnvValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function upsertEnvLocal(updates: Record<string, string>): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  let lines: string[] = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  }
  const keys = new Set(Object.keys(updates));
  const seen = new Set<string>();
  const next = lines
    .map((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (!match) return line;
      const key = match[1];
      if (!keys.has(key)) return line;
      seen.add(key);
      return `${key}=${quoteEnvValue(updates[key])}`;
    })
    .filter((line, index, arr) => {
      // drop trailing empties later; keep structure
      return !(index === arr.length - 1 && line === "" && arr.length > 1);
    });
  for (const key of keys) {
    if (!seen.has(key)) {
      next.push(`${key}=${quoteEnvValue(updates[key])}`);
    }
  }
  fs.writeFileSync(envPath, `${next.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

export function getSettings(): PanelSettings {
  const store = ensureStore();
  if (!store.settings) {
    const initial = DEFAULT_SETTINGS();
    store.settings = initial;
    saveStore(store);
    return initial;
  }
  return normalizeSettings(store.settings);
}

export function saveSettings(
  patch: Partial<PanelSettings> & { globalEnv?: EnvPair[] },
): PanelSettings {
  const store = ensureStore();
  const current = normalizeSettings(store.settings);
  const next: PanelSettings = {
    ...current,
    ...patch,
    githubPat:
      typeof patch.githubPat === "string"
        ? patch.githubPat.trim()
        : current.githubPat,
    adminPassword:
      typeof patch.adminPassword === "string"
        ? patch.adminPassword.trim()
        : current.adminPassword,
    domain:
      typeof patch.domain === "string" && patch.domain.trim()
        ? patch.domain.trim()
        : current.domain,
    dropletIp:
      typeof patch.dropletIp === "string" && patch.dropletIp.trim()
        ? patch.dropletIp.trim()
        : current.dropletIp,
    caddySslEnabled:
      typeof patch.caddySslEnabled === "boolean"
        ? patch.caddySslEnabled
        : current.caddySslEnabled,
    caddyStatus:
      patch.caddyStatus === "active" ||
      patch.caddyStatus === "inactive" ||
      patch.caddyStatus === "unknown"
        ? patch.caddyStatus
        : current.caddyStatus,
    globalEnv: Array.isArray(patch.globalEnv)
      ? patch.globalEnv
          .map((pair) => ({
            key: String(pair.key ?? "").trim(),
            value: String(pair.value ?? ""),
          }))
          .filter((pair) => pair.key.length > 0)
      : current.globalEnv,
    updatedAt: new Date().toISOString(),
  };

  store.settings = next;
  saveStore(store);

  // Sincroniza secretos al .env.local para login / clones en próximos reinicios.
  const envUpdates: Record<string, string> = {};
  if (typeof patch.githubPat === "string") {
    envUpdates.GITHUB_PAT = next.githubPat;
    process.env.GITHUB_PAT = next.githubPat;
  }
  if (typeof patch.adminPassword === "string" && next.adminPassword) {
    envUpdates.ADMIN_PASSWORD = next.adminPassword;
    process.env.ADMIN_PASSWORD = next.adminPassword;
  }
  if (Object.keys(envUpdates).length > 0) {
    try {
      upsertEnvLocal(envUpdates);
    } catch (error) {
      console.warn(
        "[settings] no se pudo actualizar .env.local:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return next;
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

function nextPortForType(
  databases: LocalDatabase[],
  type: string,
): number {
  const base = type === "redis" ? 6379 : type === "mysql" ? 3306 : 5432;
  const used = new Set(
    databases.filter((item) => item.type === type).map((item) => item.port),
  );
  let port = base;
  while (used.has(port)) {
    port += 1;
  }
  return port;
}

export function createDatabase(input: {
  name: string;
  type?: string;
  password?: string;
}): LocalDatabase {
  const store = ensureStore();
  const type = input.type === "redis" || input.type === "mysql" ? input.type : "postgres";
  const id = randomBytes(8).toString("hex");
  const port = nextPortForType(store.databases, type);
  const user = type === "redis" ? "default" : "root";
  const pass =
    (input.password || "").trim() || randomBytes(8).toString("hex");
  const dbName = input.name.replace(/[^a-z0-9_]+/gi, "_").toLowerCase() || "app";
  const host = `local-${type}`;
  const encodedUser = encodeURIComponent(user);
  const encodedPass = encodeURIComponent(pass);
  const databaseUrl =
    type === "redis"
      ? `redis://:${encodedPass}@${host}:${port}/0`
      : type === "mysql"
        ? `mysql://${encodedUser}:${encodedPass}@${host}:${port}/${dbName}`
        : `postgresql://${encodedUser}:${encodedPass}@${host}:${port}/${dbName}?schema=public`;

  const row: LocalDatabase = {
    id,
    name: input.name,
    type,
    status: "running",
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

export function deleteDatabase(id: string): boolean {
  const store = ensureStore();
  const before = store.databases.length;
  store.databases = store.databases.filter((item) => item.id !== id);
  if (store.databases.length === before) {
    return false;
  }
  saveStore(store);
  return true;
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
