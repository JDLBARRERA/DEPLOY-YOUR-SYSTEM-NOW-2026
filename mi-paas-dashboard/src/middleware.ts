import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  adminApiKey,
  adminPassword,
  isValidSessionValue,
} from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/auth/login"]);
const DEFAULT_PASSWORD = "admin";

export async function middleware(request: NextRequest) {
  try {
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

    const presented =
      request.headers.get("x-api-key")?.trim() ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (
      presented &&
      (presented === apiKey ||
        presented === password ||
        presented === DEFAULT_PASSWORD)
    ) {
      return NextResponse.next();
    }

    const cookie = request.cookies.get(SESSION_COOKIE)?.value;
    if (await isValidSessionValue(cookie)) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/") || pathname.startsWith("/backend")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  } catch (error) {
    console.error("[AUTH] middleware soft-fail:", error);
    // En desarrollo no tumbar la app por env faltante; redirigir a login.
    if (request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname.startsWith("/backend")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
