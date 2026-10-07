import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  adminPassword,
  createSessionValue,
} from "@/lib/auth";

export async function handleLogin(request: Request): Promise<NextResponse> {
  const passwordEnv = adminPassword();
  if (!passwordEnv) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD no está configurada en el servidor" },
      { status: 503 },
    );
  }

  let password = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { password?: string };
    password = String(body.password ?? "");
  } else {
    const form = await request.formData().catch(() => null);
    password = String(form?.get("password") ?? "");
  }

  if (!password || password !== passwordEnv) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const token = await createSessionValue(passwordEnv);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
