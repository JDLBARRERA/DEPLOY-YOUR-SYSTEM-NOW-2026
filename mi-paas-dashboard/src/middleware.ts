import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  adminApiKey,
  adminPassword,
  isValidSessionValue,
} from "@/lib/auth";

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/auth/login"]);

function isMachineRoute(pathname: string): boolean {
  return pathname.startsWith("/webhooks/") || pathname.startsWith("/api/");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isMachineRoute(pathname)) {
    return NextResponse.next();
  }

  try {
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
      ((apiKey && presented === apiKey) || (password && presented === password))
    ) {
      return NextResponse.next();
    }

    const cookie = request.cookies.get(SESSION_COOKIE)?.value;
    if (await isValidSessionValue(cookie)) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/backend")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  } catch (error) {
    console.error("[AUTH] middleware soft-fail:", error);
    const failedPath = request.nextUrl.pathname;
    if (isMachineRoute(failedPath)) {
      return NextResponse.next();
    }
    if (failedPath.startsWith("/backend")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
