import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const SESSION_COOKIE = "dn_session";
const SESSION_PAYLOAD = "deplowe-now-session-v1";

function adminPassword(): string {
  return (process.env.ADMIN_PASSWORD || "").trim();
}

/** ADMIN_API_KEY si existe; si no, ADMIN_PASSWORD. */
function adminApiKey(): string {
  return (process.env.ADMIN_API_KEY || "").trim() || adminPassword();
}

function authSecret(): string {
  return (process.env.NEXTAUTH_SECRET || "").trim() || adminPassword();
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function headerValue(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = headerValue(request, "cookie");
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName !== name) {
      continue;
    }
    const value = rest.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

function expectedSessionValue(): string {
  const secret = authSecret();
  if (!secret) {
    return "";
  }
  return createHmac("sha256", secret).update(SESSION_PAYLOAD).digest("base64url");
}

/**
 * Sesión de administrador (cookie dn_session) o header x-api-key / Bearer
 * igual a ADMIN_API_KEY o ADMIN_PASSWORD.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const password = adminPassword();
  const apiKey = adminApiKey();

  if (!password && !(process.env.ADMIN_API_KEY || "").trim()) {
    request.log.warn("[AUTH] ADMIN_PASSWORD no está definida");
    await reply.code(401).send({ error: "Unauthorized" });
    return reply;
  }

  const presented =
    headerValue(request, "x-api-key") ||
    headerValue(request, "authorization").replace(/^Bearer\s+/i, "").trim();

  if (
    presented &&
    ((apiKey && safeEqual(presented, apiKey)) ||
      (password && safeEqual(presented, password)))
  ) {
    return;
  }

  const cookie = readCookie(request, SESSION_COOKIE);
  const expected = expectedSessionValue();
  if (cookie && expected && safeEqual(cookie, expected)) {
    return;
  }

  await reply.code(401).send({ error: "Unauthorized" });
  return reply;
}
