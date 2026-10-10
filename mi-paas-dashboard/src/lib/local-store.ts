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

export interface LocalProject {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  memoryLimit: string;
  cpuLimit: number;
  githubToken?: string | null;
  customDomain?: string | null;
  serviceType?: "web" | "worker";
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

export interface LocalAddon {
  id: string;
  projectId: string;
  type: "postgres" | "redis";
  containerName: string;
  connectionString: string;
}

export interface LocalVariable {
  id: string;
  projectId: string;
  key: string;
  value: string;
}

interface StoreShape {
  deployments: LocalDeployment[];
  databases: LocalDatabase[];
  projects?: LocalProject[];
  addons?: LocalAddon[];
  variables?: LocalVariable[];
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
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      addons: Array.isArray(parsed.addons) ? parsed.addons : [],
      variables: Array.isArray(parsed.variables) ? parsed.variables : [],
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

export function listProjects(): LocalProject[] {
  const store = ensureStore();
  const saved = new Map((store.projects ?? []).map((project) => [project.id, project]));
  for (const deployment of store.deployments) {
    const id = `name:${deployment.projectName}`;
    if (saved.has(id)) {
      continue;
    }
    saved.set(id, {
      id,
      name: deployment.projectName,
      repoUrl: deployment.repoUrl,
      branch: deployment.branch || "main",
      memoryLimit: "256m",
      cpuLimit: 0.5,
      githubToken: null,
      customDomain: null,
      serviceType: "web",
    });
  }
  return [...saved.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ githubToken, ...project }) => ({
      ...project,
      serviceType: project.serviceType === "worker" ? "worker" : "web",
      hasGithubToken: Boolean(githubToken?.trim()),
    }));
}

const LOCAL_HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function normalizeLocalDomain(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.includes("://") || host.includes("/") || host.includes(":") || /\s/.test(host)) {
    throw new Error("Escribe solo el dominio, por ejemplo app.cliente.com");
  }
  if (!LOCAL_HOSTNAME.test(host) || host === "deplowe-now.com" || host === "www.deplowe-now.com") {
    throw new Error(
      host === "deplowe-now.com" || host === "www.deplowe-now.com"
        ? "Ese dominio pertenece al panel"
        : "customDomain no es un dominio válido",
    );
  }
  return host;
}

export function deleteLocalProject(id: string): boolean {
  const store = ensureStore();
  const known = listProjects().find((project) => project.id === id);
  if (!known) {
    return false;
  }
  store.projects = (store.projects ?? []).filter((project) => project.id !== id);
  store.addons = (store.addons ?? []).filter((addon) => addon.projectId !== id);
  store.variables = (store.variables ?? []).filter((variable) => variable.projectId !== id);
  store.deployments = store.deployments.filter(
    (deployment) => deployment.projectName !== known.name,
  );
  saveStore(store);
  return true;
}

export function updateProjectLimits(
  id: string,
  patch: {
    memoryLimit?: string;
    cpuLimit?: number;
    githubToken?: string;
    customDomain?: string;
    serviceType?: "web" | "worker";
  },
): Omit<LocalProject, "githubToken"> & { hasGithubToken: boolean } | null {
  const store = ensureStore();
  const saved = new Map((store.projects ?? []).map((project) => [project.id, project]));
  const current = listProjects().find((project) => project.id === id);
  const stored = saved.get(id);
  if (!current && !stored) {
    return null;
  }
  const base = stored ?? {
    id,
    name: current?.name ?? id,
    repoUrl: current?.repoUrl ?? "",
    branch: current?.branch ?? "main",
    memoryLimit: current?.memoryLimit ?? "256m",
    cpuLimit: current?.cpuLimit ?? 0.5,
    githubToken: null,
    customDomain: current?.customDomain ?? null,
    serviceType: current?.serviceType === "worker" ? "worker" : "web",
  };
  let customDomain = base.customDomain ?? null;
  if (patch.customDomain !== undefined) {
    const raw = patch.customDomain.trim();
    customDomain = raw ? normalizeLocalDomain(raw) : null;
    if (customDomain) {
      const taken = [...saved.values()].some(
        (project) => project.id !== id && project.customDomain?.toLowerCase() === customDomain,
      );
      if (taken) {
        throw new Error("Ese dominio ya está asignado a otro proyecto");
      }
    }
  }
  const next: LocalProject = {
    ...base,
    memoryLimit: patch.memoryLimit?.trim() || base.memoryLimit,
    cpuLimit:
      patch.cpuLimit != null && Number.isFinite(patch.cpuLimit)
        ? patch.cpuLimit
        : base.cpuLimit,
    githubToken:
      patch.githubToken === undefined
        ? base.githubToken ?? null
        : patch.githubToken.trim() || null,
    customDomain,
    serviceType:
      patch.serviceType === "worker" || patch.serviceType === "web"
        ? patch.serviceType
        : base.serviceType === "worker"
          ? "worker"
          : "web",
  };
  saved.set(id, next);
  store.projects = [...saved.values()];
  saveStore(store);
  const { githubToken, ...project } = next;
  return { ...project, hasGithubToken: Boolean(githubToken?.trim()) };
}

export function listProjectAddons(projectId: string): LocalAddon[] | null {
  const store = ensureStore();
  const known = listProjects().some((project) => project.id === projectId);
  if (!known) {
    return null;
  }
  return (store.addons ?? []).filter((addon) => addon.projectId === projectId);
}

export function createProjectAddon(
  projectId: string,
  type: string,
): LocalAddon | null {
  if (type !== "postgres" && type !== "redis") {
    throw new Error("type debe ser postgres o redis");
  }
  const store = ensureStore();
  if (!listProjects().some((project) => project.id === projectId)) {
    return null;
  }
  const suffix = randomBytes(4).toString("hex");
  const containerName = type === "postgres" ? `paas-pg-${suffix}` : `paas-redis-${suffix}`;
  const password = randomBytes(18).toString("hex");
  const connectionString =
    type === "postgres"
      ? `postgresql://usr_local:${encodeURIComponent(password)}@${containerName}:5432/db_local`
      : `redis://:${encodeURIComponent(password)}@${containerName}:6379/0`;
  const addon: LocalAddon = {
    id: randomBytes(8).toString("hex"),
    projectId,
    type,
    containerName,
    connectionString,
  };
  store.addons = [...(store.addons ?? []), addon];
  saveStore(store);
  return addon;
}

export function deleteProjectAddon(projectId: string, addonId: string): boolean {
  const store = ensureStore();
  const before = store.addons ?? [];
  const next = before.filter(
    (addon) => !(addon.projectId === projectId && addon.id === addonId),
  );
  if (next.length === before.length) {
    return false;
  }
  store.addons = next;
  saveStore(store);
  return true;
}

export function listProjectVariables(projectId: string): LocalVariable[] | null {
  const store = ensureStore();
  if (!listProjects().some((project) => project.id === projectId)) {
    return null;
  }
  return (store.variables ?? [])
    .filter((variable) => variable.projectId === projectId)
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function createLocalVariable(
  projectId: string,
  key: string,
  value: string,
): LocalVariable | null {
  const normalizedKey = key.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedKey)) {
    throw new Error("La clave debe ser un nombre de variable, por ejemplo API_URL");
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("El valor no puede tener saltos de línea");
  }
  const store = ensureStore();
  if (!listProjects().some((project) => project.id === projectId)) {
    return null;
  }
  const existing = (store.variables ?? []).find(
    (variable) => variable.projectId === projectId && variable.key === normalizedKey,
  );
  if (existing) {
    throw new Error("Esa clave ya existe en el proyecto");
  }
  const created: LocalVariable = {
    id: randomBytes(8).toString("hex"),
    projectId,
    key: normalizedKey,
    value,
  };
  store.variables = [...(store.variables ?? []), created];
  saveStore(store);
  return created;
}

export function updateLocalVariable(
  projectId: string,
  variableId: string,
  value: string,
): LocalVariable | null {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("El valor no puede tener saltos de línea");
  }
  const store = ensureStore();
  const current = (store.variables ?? []).find(
    (variable) => variable.projectId === projectId && variable.id === variableId,
  );
  if (!current) {
    return null;
  }
  const updated = { ...current, value };
  store.variables = (store.variables ?? []).map((variable) =>
    variable.id === current.id ? updated : variable,
  );
  saveStore(store);
  return updated;
}

export function deleteLocalVariable(projectId: string, variableId: string): boolean {
  const store = ensureStore();
  const before = store.variables ?? [];
  const next = before.filter(
    (variable) => !(variable.projectId === projectId && variable.id === variableId),
  );
  if (next.length === before.length) {
    return false;
  }
  store.variables = next;
  saveStore(store);
  return true;
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
