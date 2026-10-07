import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  adminApiKey,
  adminPassword,
  isValidSessionValue,
} from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/auth/login"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/icon" ||
    pathname === "/apple-icon" ||
    pathname === "/logo-deplowe-now.jpg" ||
    pathname === "/logo.jpg" ||
    /\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const password = adminPassword();
  const apiKey = adminApiKey();
  if (!password) {
    if (pathname.startsWith("/api/") || pathname.startsWith("/backend")) {
      return NextResponse.json(
        { error: "Unauthorized: configura ADMIN_PASSWORD" },
        { status: 401 },
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "missing-secret");
    return NextResponse.redirect(login);
  }

  const presented =
    request.headers.get("x-api-key")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (presented && (presented === apiKey || presented === password)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  const ok = await isValidSessionValue(cookie, password);
  if (ok) {
    return NextResponse.next();
  }

  // Protege UI, /api/* (deployments proxy, log-stream, etc.) y /backend/*
  if (pathname.startsWith("/api/") || pathname.startsWith("/backend")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
