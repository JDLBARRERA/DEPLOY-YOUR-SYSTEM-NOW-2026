import type { Redis } from "ioredis";

export interface DeploymentRecord {
  projectId: string;
  projectName: string;
  repoUrl: string;
  image: string;
  port: string;
  status: string;
  host: string;
  createdAt: string;
  commitHash?: string;
  commitMessage?: string;
  commitAuthor?: string;
  finishedAt?: string;
  trigger?: "manual" | "webhook";
}

const INDEX_KEY = "deploy:projects";

function recordKey(projectId: string): string {
  return `deploy:project:${projectId}`;
}

export class DeploymentStore {
  constructor(private readonly redis: Redis) {}

  async save(record: DeploymentRecord): Promise<void> {
    await this.redis.hset(recordKey(record.projectId), record);
    await this.redis.sadd(INDEX_KEY, record.projectId);
  }

  async update(
    projectId: string,
    patch: Partial<Omit<DeploymentRecord, "projectId">>,
  ): Promise<void> {
    const current = await this.get(projectId);
    if (!current) {
      return;
    }

    await this.redis.hset(recordKey(projectId), { ...current, ...patch, projectId });
  }

  async get(projectId: string): Promise<DeploymentRecord | null> {
    const data = await this.redis.hgetall(recordKey(projectId));
    if (!data.projectId) {
      return null;
    }

    return data as unknown as DeploymentRecord;
  }

  async list(): Promise<DeploymentRecord[]> {
    const ids = await this.redis.smembers(INDEX_KEY);
    const records = await Promise.all(ids.map((id) => this.get(id)));
    return records
      .filter((record): record is DeploymentRecord => record !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
