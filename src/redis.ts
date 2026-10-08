import { Redis } from "ioredis";

export type CreateRedisOptions = {
  /** Fallos rápidos sin reintentos infinitos (modo degradado local). */
  degraded?: boolean;
};

export function createRedis(options: CreateRedisOptions = {}): Redis {
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  const degraded = options.degraded === true;

  return new Redis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 2_000,
    enableOfflineQueue: !degraded,
    retryStrategy: degraded
      ? () => null
      : (times) => Math.min(times * 200, 2_000),
    lazyConnect: degraded,
  });
}

export async function pingRedis(timeoutMs = 2_000): Promise<boolean> {
  const client = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: 1,
    connectTimeout: timeoutMs,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });

  try {
    await client.connect();
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("redis ping timeout")), timeoutMs),
      ),
    ]);
    return result === "PONG";
  } catch {
    return false;
  } finally {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
  }
}
