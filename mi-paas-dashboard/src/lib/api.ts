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

export interface Database {
  id: string;
  name: string;
  dbName: string;
  pooledUrl: string;
  directUrl: string;
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
