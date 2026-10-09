const DEFAULT_TIMEOUT_MS = 2500;

export function apiBaseUrl(): string | null {
  const value = process.env.API_URL?.trim();
  return value || null;
}

export async function tryUpstream(
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response | null> {
  const base = apiBaseUrl();
  if (!base) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const hasBody = typeof init?.body === "string" ? init.body.length > 0 : init?.body != null;
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`, {
      ...init,
      body: hasBody ? init?.body : undefined,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    return response;
  } catch (error) {
    console.warn(
      `[standalone] upstream ${path} no disponible:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
