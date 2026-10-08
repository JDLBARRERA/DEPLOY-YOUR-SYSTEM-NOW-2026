export const SESSION_COOKIE = "dn_session";
const SESSION_PAYLOAD = "deplowe-now-session-v1";

/**
 * Secret de firma de sesión.
 * NEXTAUTH_SECRET || ADMIN_PASSWORD (sin fallbacks de desarrollo).
 */
export function authSecret(): string {
  return (
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.ADMIN_PASSWORD?.trim() ||
    ""
  );
}

/** Contraseña esperada: solo process.env.ADMIN_PASSWORD. */
export function adminPassword(): string {
  return (process.env.ADMIN_PASSWORD || "").trim();
}

/**
 * Clave para header x-api-key / Bearer.
 * Usa ADMIN_API_KEY si existe; si no, ADMIN_PASSWORD.
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
  const secret = authSecret();
  if (!secret) {
    throw new Error("[AUTH ERROR] ADMIN_PASSWORD/NEXTAUTH_SECRET no está definida");
  }
  return hmacSign(secret, SESSION_PAYLOAD);
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
  const expectedPassword = (process.env.ADMIN_PASSWORD || "").trim();
  const inputPassword = (input || "").trim();

  if (!expectedPassword) {
    console.error(
      "[AUTH ERROR] ADMIN_PASSWORD no está definida en process.env",
    );
    return false;
  }

  return inputPassword.length > 0 && inputPassword === expectedPassword;
}

export async function isAuthorizedRequest(request: Request): Promise<boolean> {
  try {
    const password = adminPassword();
    const apiKey = adminApiKey();

    if (!password && !process.env.ADMIN_API_KEY?.trim()) {
      console.error(
        "[AUTH ERROR] ADMIN_PASSWORD no está definida en process.env",
      );
      return false;
    }

    const presented =
      request.headers.get("x-api-key")?.trim() ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (presented && ((apiKey && presented === apiKey) || (password && presented === password))) {
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
