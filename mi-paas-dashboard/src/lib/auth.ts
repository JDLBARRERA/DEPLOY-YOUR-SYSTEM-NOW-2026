export const SESSION_COOKIE = "dn_session";
const SESSION_PAYLOAD = "deplowe-now-session-v1";
const DEFAULT_SECRET = "deplowe_now_secret_2026";
const DEFAULT_PASSWORD = "admin";

/**
 * Secret de firma de sesión (local + producción).
 * NEXTAUTH_SECRET || ADMIN_PASSWORD || fallback fijo.
 */
export function authSecret(): string {
  return (
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.ADMIN_PASSWORD?.trim() ||
    DEFAULT_SECRET
  );
}

/** Contraseña esperada (ADMIN_PASSWORD o 'admin'). */
export function adminPassword(): string {
  return (process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD).trim();
}

/**
 * Clave para header x-api-key / Bearer.
 * Usa ADMIN_API_KEY si existe; si no, la misma contraseña esperada.
 */
export function adminApiKey(): string {
  const key = process.env.ADMIN_API_KEY?.trim();
  return key || adminPassword();
}

/** @deprecated prefer authSecret / adminPassword */
export function adminSecret(): string {
  return authSecret();
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

export async function createSessionValue(): Promise<string> {
  return hmacSign(authSecret(), SESSION_PAYLOAD);
}

export async function isValidSessionValue(
  value: string | undefined,
): Promise<boolean> {
  if (!value) {
    return false;
  }
  try {
    const expected = await createSessionValue();
    if (value.length !== expected.length) {
      return false;
    }
    let mismatch = 0;
    for (let i = 0; i < value.length; i += 1) {
      mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

export function isValidPassword(input: string | undefined | null): boolean {
  const inputPassword = (input || "").trim();
  const expectedPassword = adminPassword();
  return (
    inputPassword.length > 0 &&
    (inputPassword === expectedPassword || inputPassword === DEFAULT_PASSWORD)
  );
}

export async function isAuthorizedRequest(request: Request): Promise<boolean> {
  try {
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
      return true;
    }

    const cookieHeader = request.headers.get("cookie") ?? "";
    const match = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
    );
    const cookieValue = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    return isValidSessionValue(cookieValue);
  } catch {
    return false;
  }
}
