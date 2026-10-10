import { execSync } from "node:child_process";

const PRUNE_COMMANDS = [
  "docker image prune -f --filter until=24h",
  "docker builder prune -f --filter until=24h",
  "docker container prune -f --filter label=paas.app",
] as const;

export function pruneDockerDisk(): void {
  for (const command of PRUNE_COMMANDS) {
    try {
      const output = execSync(command, {
        encoding: "utf8",
        stdio: "pipe",
        timeout: 120_000,
      }).trim();
      console.log(`[prune] ${command}${output ? `\n${output}` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[prune] ${command} falló: ${message}`);
    }
  }
}
