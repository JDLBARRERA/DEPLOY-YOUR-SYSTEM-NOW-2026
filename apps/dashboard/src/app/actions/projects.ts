"use server";

import { auth } from "@/auth";
import { prisma } from "@/db";

export interface DeploymentView {
  id: string;
  status: string;
  type: "PRODUCTION" | "PREVIEW";
  branch: string | null;
  url: string | null;
  commitHash: string | null;
  commitMessage: string | null;
  commitAuthor: string | null;
  commitAuthorAvatar: string | null;
  createdAt: string;
}

export interface EnvVarView {
  id: string;
  key: string;
  value: string;
  environment: "ALL" | "PRODUCTION" | "PREVIEW";
}

export interface ProjectDeployments {
  id: string;
  name: string;
  repoUrl: string;
  deployments: DeploymentView[];
  env: EnvVarView[];
}

export async function listProjectDeployments(): Promise<{
  projects?: ProjectDeployments[];
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Inicia sesión para ver los despliegues." };
  }

  const projects = await prisma.project.findMany({
    where: { team: { ownerId: session.user.id } },
    orderBy: { createdAt: "desc" },
    include: {
      deployments: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      env: {
        orderBy: [{ key: "asc" }, { environment: "asc" }],
      },
    },
  });

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      repoUrl: project.repoUrl,
      env: project.env.map((variable) => ({
        id: variable.id,
        key: variable.key,
        value: variable.value,
        environment: variable.environment,
      })),
      deployments: project.deployments.map((deployment) => ({
        id: deployment.id,
        status: deployment.status,
        type: deployment.type,
        branch: deployment.branch,
        url: deployment.url,
        commitHash: deployment.commitHash,
        commitMessage: deployment.commitMessage,
        commitAuthor: deployment.commitAuthor ?? null,
        commitAuthorAvatar: deployment.commitAuthorAvatar ?? null,
        createdAt: deployment.createdAt.toISOString(),
      })),
    })),
  };
}
