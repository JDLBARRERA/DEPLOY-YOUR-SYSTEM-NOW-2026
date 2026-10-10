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

export async function replaceProjectEnvironmentGroups(
  projectId: string,
  groupIds: string[],
): Promise<void> {
  const unique = [...new Set(groupIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  const found = await prisma.environmentGroup.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new Error("Hay un grupo que no existe");
  }
  await prisma.$transaction([
    prisma.projectEnvironmentGroup.deleteMany({ where: { projectId } }),
    ...(unique.length > 0
      ? [
          prisma.projectEnvironmentGroup.createMany({
            data: unique.map((groupId) => ({ projectId, groupId })),
          }),
        ]
      : []),
  ]);
}

export function mergeGroupAndProjectVariables(
  links: Array<{ group: { name: string; variables: Array<{ key: string; value: string }> } }>,
  projectVariables: Array<{ key: string; value: string }>,
): Array<{ key: string; value: string }> {
  const ordered = [...links].sort((left, right) => left.group.name.localeCompare(right.group.name));
  const merged = new Map<string, string>();
  for (const link of ordered) {
    for (const variable of link.group.variables) {
      merged.set(variable.key, variable.value);
    }
  }
  for (const variable of projectVariables) {
    merged.set(variable.key, variable.value);
  }
  return [...merged].map(([key, value]) => ({ key, value }));
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

export async function updateProjectVariable(projectId: string, variableId: string, value: string) {
  const existing = await prisma.environmentVariable.findFirst({
    where: { id: variableId, projectId },
    select: { id: true, key: true },
  });
  if (!existing) {
    return null;
  }
  const pair = normalizeEnvPair(existing.key, value);
  return prisma.environmentVariable.update({
    where: { id: existing.id },
    data: { value: pair.value },
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
  serviceType: "web" | "worker";
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
      serviceType: "web",
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
          serviceType: true,
          env: {
            select: { key: true, value: true, environment: true },
          },
          variables: {
            select: { key: true, value: true },
          },
          environmentGroups: {
            select: {
              group: {
                select: {
                  name: true,
                  variables: { select: { key: true, value: true } },
                },
              },
            },
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
      serviceType: "web",
      plainVariables: [],
    };
  }

  return {
    deploymentType: deployment.type,
    memoryLimit: deployment.project.memoryLimit || "256m",
    cpuLimit: deployment.project.cpuLimit || 0.5,
    githubToken: deployment.project.githubToken,
    customDomain: deployment.project.customDomain,
    serviceType: deployment.project.serviceType === "worker" ? "worker" : "web",
    plainVariables: mergeGroupAndProjectVariables(
      deployment.project.environmentGroups,
      deployment.project.variables,
    ),
    variables: deployment.project.env.map((variable: any) => ({
      key: variable.key,
      value: variable.value,
      environment: variable.environment,
    })),
  };
}
