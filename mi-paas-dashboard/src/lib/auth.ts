export const SESSION_COOKIE = "dn_session";
const SESSION_PAYLOAD = "deplowe-now-session-v1";

/** Contraseña de login (ADMIN_PASSWORD, fallback local admin123). */
export function adminPassword(): string {
  return (process.env.ADMIN_PASSWORD || "admin123").trim();
}

/**
 * Clave para header x-api-key / Bearer.
 * Usa ADMIN_API_KEY si existe; si no, la misma ADMIN_PASSWORD.
 */
export function adminApiKey(): string {
  return process.env.ADMIN_API_KEY?.trim() || adminPassword();
}

/** @deprecated prefer adminPassword / adminApiKey */
export function adminSecret(): string {
  return adminApiKey();
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toBase64Url(signature);
}

export async function createSessionValue(password: string): Promise<string> {
  return hmacSign(password, SESSION_PAYLOAD);
}

export async function isValidSessionValue(
  value: string | undefined,
  password: string,
): Promise<boolean> {
  if (!value || !password) {
    return false;
  }
  const expected = await createSessionValue(password);
  if (value.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < value.length; i += 1) {
    mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function isAuthorizedRequest(request: Request): Promise<boolean> {
  const password = adminPassword();
  const apiKey = adminApiKey();
  if (!password && !apiKey) {
    return false;
  }

  const presented =
    request.headers.get("x-api-key")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (presented && (presented === apiKey || presented === password)) {
    return true;
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const cookieValue = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  return isValidSessionValue(cookieValue, password);
}
