import { prisma } from "../db.js";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function readEnvRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || item.includes("\n") || item.includes("\r")) {
      continue;
    }
    if (!ENV_KEY.test(key)) {
      continue;
    }
    env[key] = item;
  }
  return env;
}

export async function envForDeployment(
  deploymentId: string | undefined,
): Promise<Record<string, string>> {
  if (!deploymentId) {
    return {};
  }

  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: { project: { select: { envVars: true } } },
  });

  return readEnvRecord(deployment?.project.envVars);
}
