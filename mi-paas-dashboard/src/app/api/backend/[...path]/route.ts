import { NextResponse } from "next/server";
import { adminApiKey, isAuthorizedRequest } from "@/lib/auth";
import {
  createDatabase,
  createDeployment,
  createProjectAddon,
  deleteDatabase,
  deleteProjectAddon,
  getSettings,
  isSqliteUrl,
  listDatabases,
  listDeployments,
  listProjectAddons,
  listProjects,
  redeploy,
  saveSettings,
  updateProjectLimits,
  type EnvPair,
  type PanelSettings,
} from "@/lib/local-store";
import { tryUpstream } from "@/lib/upstream";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Ctx): Promise<Response> {
  const { path } = await context.params;
  const segments = path ?? [];
  const joined = segments.join("/");
  const method = request.method.toUpperCase();
  const isDatabasesRoute = segments[0] === "databases";
  const isDeployRoute = segments[0] === "deploy";
  const isProjectsRoute = segments[0] === "projects";
  const isSettingsRoute = segments[0] === "settings";
  const forceLocal =
    isSettingsRoute || (isDatabasesRoute && isSqliteUrl());

  if (
    (isDeployRoute || isDatabasesRoute || isProjectsRoute) &&
    !(await isAuthorizedRequest(request))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let bodyText: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    bodyText = await request.text();
  }

  if (!forceLocal) {
    const upstream = await tryUpstream(joined + new URL(request.url).search, {
      method,
      body: bodyText,
      headers: {
        Accept: request.headers.get("Accept") ?? "application/json",
        ...(isDeployRoute || isDatabasesRoute || isProjectsRoute
          ? { "x-api-key": adminApiKey() }
          : {}),
      },
    });

    if (upstream && upstream.status < 500) {
      // DELETE de databases puede no existir en el motor; caer a local.
      if (
        !(
          (isDatabasesRoute &&
            method === "DELETE" &&
            (upstream.status === 404 ||
              upstream.status === 405 ||
              upstream.status === 501)) ||
          (isProjectsRoute &&
            (upstream.status === 404 || upstream.status === 501))
        )
      ) {
        const headers = new Headers(upstream.headers);
        headers.set("x-dn-mode", "upstream");
        return new Response(upstream.body, {
          status: upstream.status,
          headers,
        });
      }
    }
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

  if (method === "GET" && head === "projects" && !id) {
    return NextResponse.json(listProjects(), {
      headers: { "x-dn-mode": "local" },
    });
  }

  if ((method === "PATCH" || method === "PUT") && head === "projects" && id && !action) {
    const body = parseJson(bodyText) as {
      memoryLimit?: string;
      cpuLimit?: number;
      githubToken?: string;
      customDomain?: string;
    };
    let updated: ReturnType<typeof updateProjectLimits>;
    try {
      updated = updateProjectLimits(id, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar";
      const status = message.includes("ya está asignado") ? 409 : 400;
      return NextResponse.json(
        { error: message },
        { status, headers: { "x-dn-mode": "local" } },
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 404, headers: { "x-dn-mode": "local" } },
      );
    }
    return NextResponse.json(updated, {
      headers: { "x-dn-mode": "local" },
    });
  }

  if (head === "projects" && id && action === "addons") {
    const addonId = segments[3];
    if (method === "GET" && !addonId) {
      const rows = listProjectAddons(id);
      if (!rows) {
        return NextResponse.json(
          { error: "Proyecto no encontrado" },
          { status: 404, headers: { "x-dn-mode": "local" } },
        );
      }
      return NextResponse.json(rows, { headers: { "x-dn-mode": "local" } });
    }
    if (method === "POST" && !addonId) {
      const body = parseJson(bodyText) as { type?: string };
      try {
        const created = createProjectAddon(id, body.type ?? "");
        if (!created) {
          return NextResponse.json(
            { error: "Proyecto no encontrado" },
            { status: 404, headers: { "x-dn-mode": "local" } },
          );
        }
        return NextResponse.json(created, {
          status: 201,
          headers: { "x-dn-mode": "local" },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo crear la base";
        return NextResponse.json(
          { error: message },
          { status: 400, headers: { "x-dn-mode": "local" } },
        );
      }
    }
    if (method === "DELETE" && addonId && !segments[4]) {
      const ok = deleteProjectAddon(id, addonId);
      if (!ok) {
        return NextResponse.json(
          { error: "Base de datos no encontrada" },
          { status: 404, headers: { "x-dn-mode": "local" } },
        );
      }
      return NextResponse.json(
        { ok: true },
        { status: 200, headers: { "x-dn-mode": "local" } },
      );
    }
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

  if (method === "GET" && head === "settings" && !id) {
    return NextResponse.json(getSettings(), {
      headers: { "x-dn-mode": "local" },
    });
  }

  if (
    (method === "PUT" || method === "POST" || method === "PATCH") &&
    head === "settings" &&
    !id
  ) {
    const body = parseJson(bodyText) as Partial<PanelSettings> & {
      globalEnv?: EnvPair[];
    };
    const saved = saveSettings(body);
    return NextResponse.json(saved, {
      status: 200,
      headers: { "x-dn-mode": "local" },
    });
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
    const body = parseJson(bodyText) as {
      name?: string;
      type?: string;
      password?: string;
    };
    if (!body.name) {
      return NextResponse.json({ error: "name es requerido" }, { status: 400 });
    }
    const created = createDatabase({
      name: body.name,
      type: body.type,
      password: body.password,
    });
    return NextResponse.json(
      { ...created, DATABASE_URL: created.DATABASE_URL },
      { status: 201, headers: { "x-dn-mode": "local" } },
    );
  }

  if (method === "DELETE" && head === "databases" && id && !action) {
    const ok = deleteDatabase(id);
    if (!ok) {
      return NextResponse.json(
        { error: "Base de datos no encontrada" },
        { status: 404, headers: { "x-dn-mode": "local" } },
      );
    }
    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { "x-dn-mode": "local" } },
    );
  }

  if (method === "POST" && head === "deployments" && id && action === "redeploy") {
    const result = redeploy(id);
    if (!result) {
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
