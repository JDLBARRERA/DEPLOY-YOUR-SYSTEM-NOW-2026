"use server";

import { auth } from "@/auth";
import { prisma } from "@/db";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SCOPES = ["ALL", "PRODUCTION", "PREVIEW"] as const;

type EnvScopeName = (typeof SCOPES)[number];

function isScope(value: string): value is EnvScopeName {
  return SCOPES.some((scope) => scope === value);
}

async function ownedProject(projectId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  return prisma.project.findFirst({
    where: { id: projectId, team: { ownerId: session.user.id } },
    select: { id: true },
  });
}

export async function saveProjectEnvVar(input: {
  projectId: string;
  key: string;
  value: string;
  environment: string;
}): Promise<{ error?: string }> {
  const project = await ownedProject(input.projectId);
  if (!project) {
    return { error: "No puedes editar las variables de este proyecto." };
  }

  const key = input.key.trim();
  if (!ENV_KEY.test(key) || !isScope(input.environment)) {
    return { error: "La clave o el ámbito no son válidos." };
  }
  if (!input.value || input.value.includes("\n") || input.value.includes("\r")) {
    return { error: "El valor no puede estar vacío ni llevar saltos de línea." };
  }

  await prisma.envVar.upsert({
    where: {
      projectId_key_environment: {
        projectId: input.projectId,
        key,
        environment: input.environment,
      },
    },
    create: {
      projectId: input.projectId,
      key,
      value: input.value,
      environment: input.environment,
    },
    update: { value: input.value },
  });
  return {};
}

export async function deleteProjectEnvVar(input: {
  projectId: string;
  id: string;
}): Promise<{ error?: string }> {
  const project = await ownedProject(input.projectId);
  if (!project) {
    return { error: "No puedes editar las variables de este proyecto." };
  }

  await prisma.envVar.deleteMany({
    where: { id: input.id, projectId: input.projectId },
  });
  return {};
}
