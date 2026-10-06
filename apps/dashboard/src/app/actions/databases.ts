"use server";

import { auth } from "@/auth";
import { prisma } from "@/db";

export interface DatabaseView {
  id: string;
  name: string;
  dbName: string;
  dbUser: string;
  projectId: string | null;
  parentId: string | null;
  pooledUrl: string;
  directUrl: string;
  createdAt: string;
}

export interface ProjectOption {
  id: string;
  name: string;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "La API de bases de datos no respondió";
  } catch {
    return "La API de bases de datos no respondió";
  }
}

export async function listDatabases(): Promise<{
  databases?: DatabaseView[];
  error?: string;
}> {
  const userId = await requireUser();
  if (!userId) {
    return { error: "Inicia sesión para ver las bases de datos." };
  }

  try {
    const response = await fetch(`${apiUrl}/databases`, { cache: "no-store" });
    if (!response.ok) {
      return { error: await readError(response) };
    }
    const databases = (await response.json()) as DatabaseView[];
    return { databases };
  } catch {
    return { error: "La API no respondió" };
  }
}

export async function createDatabase(
  name: string,
): Promise<{ database?: DatabaseView; error?: string }> {
  const userId = await requireUser();
  if (!userId) {
    return { error: "Inicia sesión para crear una base de datos." };
  }

  try {
    const response = await fetch(`${apiUrl}/databases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      return { error: await readError(response) };
    }
    const database = (await response.json()) as DatabaseView;
    return { database };
  } catch {
    return { error: "La API no respondió" };
  }
}

export async function branchDatabase(
  dbName: string,
  name: string,
): Promise<{ database?: DatabaseView; error?: string }> {
  const userId = await requireUser();
  if (!userId) {
    return { error: "Inicia sesión para crear un branch." };
  }

  try {
    const response = await fetch(`${apiUrl}/databases/${dbName}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      return { error: await readError(response) };
    }
    const database = (await response.json()) as DatabaseView;
    return { database };
  } catch {
    return { error: "La API no respondió" };
  }
}

export async function linkDatabase(
  id: string,
  projectId: string,
): Promise<{ error?: string }> {
  const userId = await requireUser();
  if (!userId) {
    return { error: "Inicia sesión para vincular la base." };
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, team: { ownerId: userId } },
  });
  if (!project) {
    return { error: "Ese proyecto no pertenece a tu equipo." };
  }

  try {
    const response = await fetch(`${apiUrl}/databases/${id}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!response.ok) {
      return { error: await readError(response) };
    }
    return {};
  } catch {
    return { error: "La API no respondió" };
  }
}

export async function listLinkableProjects(): Promise<ProjectOption[]> {
  const userId = await requireUser();
  if (!userId) {
    return [];
  }

  return prisma.project.findMany({
    where: { team: { ownerId: userId } },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  });
}
