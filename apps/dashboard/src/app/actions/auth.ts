"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/db";
import { ensurePersonalTeam } from "@/lib/teams";

export async function registerUser(
  _state: { error: string },
  formData: FormData,
): Promise<{ error: string }> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .toLowerCase()
    .trim();
  const password = String(formData.get("password") ?? "");

  if (!email.includes("@") || password.length < 8) {
    return { error: "Usa un email válido y una contraseña de al menos 8 caracteres." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Ese email ya está registrado." };
  }

  const total = await prisma.user.count();
  const user = await prisma.user.create({
    data: {
      name: name || null,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: total === 0 ? "admin" : "member",
    },
  });
  await ensurePersonalTeam(user.id, email, name || null);

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "No se pudo iniciar sesión después del registro." };
    }
    throw error;
  }

  return { error: "" };
}

export async function signInWithCredentials(
  _state: { error: string },
  formData: FormData,
): Promise<{ error: string }> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Email o contraseña incorrectos." };
    }
    throw error;
  }

  return { error: "" };
}

export async function signInWithGitHub(
  _state: { error: string },
  _formData: FormData,
): Promise<{ error: string }> {
  if (!process.env.AUTH_GITHUB_ID || !process.env.AUTH_GITHUB_SECRET) {
    return {
      error:
        "GitHub OAuth no está configurado. Añade AUTH_GITHUB_ID y AUTH_GITHUB_SECRET.",
    };
  }

  try {
    await signIn("github", { redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "No se pudo entrar con GitHub." };
    }
    throw error;
  }

  return { error: "" };
}

export async function signOutUser(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
