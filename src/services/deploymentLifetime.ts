import type { Prisma } from "../generated/prisma/index.js";
import { prisma } from "../db.js";
import { syncDeployment } from "./syncDeployment.js";

export async function markDeploymentRunning(
  deploymentId: string | undefined,
  extra: Prisma.DeploymentUpdateInput,
): Promise<void> {
  if (!deploymentId) {
    return;
  }
  const now = new Date();
  const current = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: { projectId: true },
  });
  if (current) {
    await prisma.deployment.updateMany({
      where: {
        projectId: current.projectId,
        status: "running",
        id: { not: deploymentId },
      },
      data: { status: "replaced", stoppedAt: now },
    });
  }
  await syncDeployment(deploymentId, {
    ...extra,
    status: "running",
    startedAt: now,
  });
}

export async function stopRunningDeployments(projectId: string): Promise<void> {
  await prisma.deployment.updateMany({
    where: { projectId, status: "running" },
    data: { status: "replaced", stoppedAt: new Date() },
  });
}
