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

export function redactEnvValues(text: string, env: Record<string, string>): string {
  const secrets = Object.values(env)
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length);
  let redacted = text;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join("***");
  }
  return redacted;
}

export function normalizeEnvPair(key: string, value: string): { key: string; value: string } {
  const normalizedKey = key.trim();
  if (!ENV_KEY.test(normalizedKey) || normalizedKey.length > 128) {
    throw new Error("La clave debe ser un nombre de variable, por ejemplo API_URL");
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("El valor no puede tener saltos de línea");
  }
  if (value.length > 8000) {
    throw new Error("El valor es demasiado largo");
  }
  return { key: normalizedKey, value };
}

const variableSelect = {
  id: true,
  projectId: true,
  key: true,
  value: true,
} as const;

export async function listProjectVariables(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return null;
  }
  return prisma.environmentVariable.findMany({
    where: { projectId },
    orderBy: { key: "asc" },
    select: variableSelect,
  });
}

export async function createProjectVariable(projectId: string, key: string, value: string) {
  const pair = normalizeEnvPair(key, value);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return null;
  }
  return prisma.environmentVariable.create({
    data: { projectId, key: pair.key, value: pair.value },
    select: variableSelect,
  });
}

export async function deleteProjectVariable(projectId: string, variableId: string) {
  const existing = await prisma.environmentVariable.findFirst({
    where: { id: variableId, projectId },
    select: { id: true },
  });
  if (!existing) {
    return false;
  }
  await prisma.environmentVariable.delete({ where: { id: existing.id } });
  return true;
}

export async function variablesForDeployment(deploymentId: string | undefined): Promise<{
  variables: ScopedEnvVar[];
  deploymentType: DeploymentEnvType;
  memoryLimit: string;
  cpuLimit: number;
  githubToken: string | null;
  customDomain: string | null;
  plainVariables: Array<{ key: string; value: string }>;
}> {
  if (!deploymentId) {
    return {
      variables: [],
      deploymentType: "PRODUCTION",
      memoryLimit: "256m",
      cpuLimit: 0.5,
      githubToken: null,
      customDomain: null,
      plainVariables: [],
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
          variables: {
            select: { key: true, value: true },
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
      plainVariables: [],
    };
  }

  return {
    deploymentType: deployment.type,
    memoryLimit: deployment.project.memoryLimit || "256m",
    cpuLimit: deployment.project.cpuLimit || 0.5,
    githubToken: deployment.project.githubToken,
    customDomain: deployment.project.customDomain,
    plainVariables: deployment.project.variables,
    variables: deployment.project.env.map((variable: any) => ({
      key: variable.key,
      value: variable.value,
      environment: variable.environment,
    })),
  };
}
