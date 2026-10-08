import { prisma } from "../db.js";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type EnvScopeName = "ALL" | "PRODUCTION" | "PREVIEW";
export type DeploymentEnvType = "PRODUCTION" | "PREVIEW";

export interface ScopedEnvVar {
  key: string;
  value: string;
  environment: EnvScopeName;
}

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

export function selectEnv(
  variables: ScopedEnvVar[],
  deploymentType: DeploymentEnvType,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.environment === "ALL") {
      env[variable.key] = variable.value;
    }
  }
  for (const variable of variables) {
    if (variable.environment === deploymentType) {
      env[variable.key] = variable.value;
    }
  }
  return env;
}

export async function variablesForDeployment(deploymentId: string | undefined): Promise<{
  variables: ScopedEnvVar[];
  deploymentType: DeploymentEnvType;
  memoryLimit: string;
  cpuLimit: number;
  githubToken: string | null;
  customDomain: string | null;
}> {
  if (!deploymentId) {
    return {
      variables: [],
      deploymentType: "PRODUCTION",
      memoryLimit: "256m",
      cpuLimit: 0.5,
      githubToken: null,
      customDomain: null,
    };
  }

  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: {
      type: true,
      project: {
        select: {
          memoryLimit: true,
          cpuLimit: true,
          githubToken: true,
          customDomain: true,
          env: {
            select: { key: true, value: true, environment: true },
          },
        },
      },
    },
  });

  if (!deployment) {
    return {
      variables: [],
      deploymentType: "PRODUCTION",
      memoryLimit: "256m",
      cpuLimit: 0.5,
      githubToken: null,
      customDomain: null,
    };
  }

  return {
    deploymentType: deployment.type,
    memoryLimit: deployment.project.memoryLimit || "256m",
    cpuLimit: deployment.project.cpuLimit || 0.5,
    githubToken: deployment.project.githubToken,
    customDomain: deployment.project.customDomain,
    variables: deployment.project.env.map((variable: any) => ({
      key: variable.key,
      value: variable.value,
      environment: variable.environment,
    })),
  };
}
