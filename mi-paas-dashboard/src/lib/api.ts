export interface Deployment {
  projectId: string;
  projectName: string;
  repoUrl: string;
  image?: string;
  port?: number | null;
  status: "queued" | "building" | "running" | "failed" | string;
  host?: string;
  url?: string;
  createdAt: string;
}

export type DatabaseEngine = "postgres" | "mysql" | "redis";

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

export interface Database {
  id: string;
  name: string;
  type?: DatabaseEngine | string;
  status?: string;
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
}

interface ApiErrorBody {
  error?: string;
  message?: string;
}

export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`/backend${endpoint}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(
      errorData.message || errorData.error || `Error HTTP: ${res.status}`,
    );
  }

  return res.json() as Promise<T>;
}
