import type { Redis } from "ioredis";

const LOG_TTL_SECONDS = 60 * 60 * 24;

function logKey(projectId: string): string {
  return `deploy:logs:${projectId}`;
}

export class LogBus {
  constructor(private readonly redis: Redis) {}

  async append(projectId: string, line: string): Promise<void> {
    const key = logKey(projectId);
    await this.redis.rpush(key, line);
    await this.redis.expire(key, LOG_TTL_SECONDS);
    await this.redis.publish(key, line);
  }

  async history(projectId: string): Promise<string[]> {
    return this.redis.lrange(logKey(projectId), 0, -1);
  }

  async subscribe(
    projectId: string,
    onLine: (line: string) => void,
  ): Promise<() => Promise<void>> {
    const subscriber = this.redis.duplicate();
    const channel = logKey(projectId);

    await subscriber.subscribe(channel);
    subscriber.on("message", (incoming, message) => {
      if (incoming === channel) {
        onLine(message);
      }
    });

    return async () => {
      await subscriber.unsubscribe(channel);
      subscriber.disconnect();
    };
  }
}
