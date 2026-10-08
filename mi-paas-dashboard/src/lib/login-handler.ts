import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  adminPassword,
  createSessionValue,
  isValidPassword,
} from "@/lib/auth";

export async function handleLogin(request: Request): Promise<NextResponse> {
  try {
    const expectedPassword = adminPassword();

    let credentialsPassword = "";
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => ({}))) as {
        password?: string;
      };
      credentialsPassword = String(body.password ?? "");
    } else {
      const form = await request.formData().catch(() => null);
      credentialsPassword = String(form?.get("password") ?? "");
    }

    const inputPassword = (credentialsPassword || "").trim();

    console.log(
      "[AUTH DEBUG] Ingresado:",
      inputPassword,
      "| Esperado:",
      expectedPassword,
    );

    if (!isValidPassword(inputPassword)) {
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 401 },
      );
    }

    const token = await createSessionValue();
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
  } catch (error) {
    console.error("[AUTH] login failed without throwing to client:", error);
    return NextResponse.json(
      { error: "Credenciales inválidas" },
      { status: 401 },
    );
  }
}
