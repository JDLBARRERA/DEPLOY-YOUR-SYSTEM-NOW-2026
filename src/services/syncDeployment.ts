import type { Prisma } from "../generated/prisma/index.js";
import { prisma } from "../db.js";

export async function syncDeployment(
  deploymentId: string | undefined,
  data: Prisma.DeploymentUpdateInput,
): Promise<void> {
  if (!deploymentId) {
    return;
  }

  try {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    console.error(`Postgres deployment ${deploymentId} was not updated: ${message}`);
  }
}
