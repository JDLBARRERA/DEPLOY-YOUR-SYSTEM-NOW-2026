"use server";

import { auth } from "@/auth";
import { prisma } from "@/db";

export async function startDeploy(
  repoUrl: string,
  projectName: string,
  databaseId?: string,
): Promise<{ projectId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Inicia sesión para desplegar." };
  }

  const team = await prisma.team.findFirst({
    where: { ownerId: session.user.id },
  });
  if (!team) {
    return { error: "No hay un equipo para este usuario." };
  }

  const project = await prisma.project.create({
    data: {
      name: projectName,
      repoUrl,
      teamId: team.id,
      branch: "main",
    },
  });

  if (databaseId) {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
    const linked = await fetch(`${apiUrl}/databases/${databaseId}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    if (!linked.ok) {
      const body = (await linked.json()) as { error?: string };
      return { error: body.error ?? "No se pudo vincular la base de datos" };
    }
  }

  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: "queued",
      type: "PRODUCTION",
      branch: "main",
    },
  });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
  const response = await fetch(`${apiUrl}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoUrl,
      projectName,
      deploymentId: deployment.id,
    }),
  });
  const data = (await response.json()) as { projectId?: string; error?: string };

  if (!response.ok || !data.projectId) {
    const message = data.error ?? "No se pudo encolar el despliegue";
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "failed", buildLogs: message },
    });
    return { error: message };
  }

  return { projectId: data.projectId };
}
