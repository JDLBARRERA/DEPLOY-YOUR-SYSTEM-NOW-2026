import { NextResponse } from "next/server";
import {
  createDatabase,
  createDeployment,
  listDatabases,
  listDeployments,
  redeploy,
} from "@/lib/local-store";
import { tryUpstream } from "@/lib/upstream";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Ctx): Promise<Response> {
  const { path } = await context.params;
  const segments = path ?? [];
  const joined = segments.join("/");
  const method = request.method.toUpperCase();

  // Intenta motor remoto/producción primero; si falla, modo local.
  let bodyText: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    bodyText = await request.text();
  }

  const upstream = await tryUpstream(joined + new URL(request.url).search, {
    method,
    body: bodyText,
    headers: {
      Accept: request.headers.get("Accept") ?? "application/json",
    },
  });

  if (upstream && upstream.status < 500) {
    const headers = new Headers(upstream.headers);
    headers.set("x-dn-mode", "upstream");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  return localFallback(method, segments, bodyText);
}

async function localFallback(
  method: string,
  segments: string[],
  bodyText?: string,
): Promise<Response> {
  const [head, id, action] = segments;

  if (method === "GET" && head === "deployments" && !id) {
    return NextResponse.json(listDeployments(), {
      headers: { "x-dn-mode": "local" },
    });
  }

  if (method === "GET" && head === "databases" && !id) {
    return NextResponse.json(listDatabases(), {
      headers: { "x-dn-mode": "local" },
    });
  }

  if (method === "GET" && head === "health") {
    return NextResponse.json(
      { ok: true, mode: "local", store: "file:./dev.db" },
      { headers: { "x-dn-mode": "local" } },
    );
  }

  if (method === "POST" && head === "deploy") {
    const body = parseJson(bodyText) as {
      repoUrl?: string;
      projectName?: string;
      branch?: string;
      clearCache?: boolean;
    };
    if (!body.repoUrl || !body.projectName) {
      return NextResponse.json(
        { error: "repoUrl y projectName son requeridos" },
        { status: 400 },
      );
    }
    const queued = createDeployment({
      repoUrl: body.repoUrl,
      projectName: body.projectName,
      branch: body.branch,
      clearCache: body.clearCache,
    });
    return NextResponse.json(queued, {
      status: 202,
      headers: { "x-dn-mode": "local" },
    });
  }

  if (method === "POST" && head === "databases" && !id) {
    const body = parseJson(bodyText) as { name?: string; type?: string };
    if (!body.name) {
      return NextResponse.json({ error: "name es requerido" }, { status: 400 });
    }
    const created = createDatabase({ name: body.name, type: body.type });
    return NextResponse.json(
      { ...created, DATABASE_URL: created.DATABASE_URL },
      { status: 201, headers: { "x-dn-mode": "local" } },
    );
  }

  if (method === "POST" && head === "deployments" && id && action === "redeploy") {
    const result = redeploy(id);
    if (!result) {
      // Re-encola desde lista si el id no es local
      return NextResponse.json(
        {
          error:
            "Redeploy local: despliegue no encontrado en store local. Arranca el motor o vuelve a crear el deploy.",
        },
        { status: 404, headers: { "x-dn-mode": "local" } },
      );
    }
    return NextResponse.json(result, {
      status: 202,
      headers: { "x-dn-mode": "local" },
    });
  }

  return NextResponse.json(
    {
      error:
        "Modo local: el motor remoto no responde y esta ruta no está simulada. Usa Overview/Deployments/Databases básicos o configura API_URL.",
      path: segments.join("/"),
    },
    { status: 503, headers: { "x-dn-mode": "local" } },
  );
}

function parseJson(text?: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
