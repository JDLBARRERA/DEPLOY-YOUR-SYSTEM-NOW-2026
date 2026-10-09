import http from "node:http";
import { routeHosts } from "./customDomain.js";

const DEFAULT_ADMIN_URL = "http://localhost:2019";
const ROUTES_PATH = "/config/apps/http/servers/paas/routes";
const CATCH_ALL_ID = "route-catch-all";
const PANEL_DIAL = "172.18.0.1:3000";

const catchAllRoute = {
  "@id": CATCH_ALL_ID,
  handle: [
    {
      handler: "static_response",
      status_code: 404,
      body: "Not Found",
    },
  ],
  terminal: true,
};

export class CaddyClient {
  private readonly adminUrl: string;

  constructor(adminUrl = process.env.CADDY_ADMIN_URL ?? DEFAULT_ADMIN_URL) {
    this.adminUrl = normalizeAdminUrl(adminUrl);
  }

  async ensureCatchAll(): Promise<void> {
    const routes = await this.readRoutes();
    for (let index = routes.length - 1; index >= 0; index -= 1) {
      if (proxiesToPanel(routes[index])) {
        await this.adminRequest("DELETE", `${ROUTES_PATH}/${index}`, "");
      }
    }

    const remaining = await this.readRoutes();
    const catchAllIndex = remaining.findIndex((route) => route["@id"] === CATCH_ALL_ID);
    if (catchAllIndex === remaining.length - 1 && catchAllIndex >= 0) {
      return;
    }
    if (catchAllIndex >= 0) {
      await this.adminRequest("DELETE", `/id/${CATCH_ALL_ID}`, "");
    }
    await this.adminRequest("POST", ROUTES_PATH, JSON.stringify(catchAllRoute));
    console.log("Caddy: los hosts sin proyecto responden 404");
  }

  async upsertRoute(
    projectId: string,
    host: string,
    upstream: string,
    customDomain?: string | null,
  ): Promise<void> {
    const dial = upstream.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*:\d+$/.test(dial)) {
      throw new Error(`Upstream Caddy inválido: ${upstream}`);
    }
    const hosts = routeHosts(host, customDomain);
    for (const name of hosts) {
      if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)) {
        throw new Error(`Host Caddy inválido: ${name}`);
      }
    }

    const route = {
      "@id": `route-${projectId}`,
      match: [{ host: hosts }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial }],
        },
      ],
      terminal: true,
    };
    const body = JSON.stringify(route);

    try {
      await this.adminRequest("PATCH", `/id/route-${projectId}`, body);
      console.log(`Caddy: ruta actualizada para ${hosts.join(", ")} → ${dial}`);
      return;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    await this.ensureCatchAll();
    await this.adminRequest("POST", `${ROUTES_PATH}/0`, body);
    console.log(`Caddy: ruta creada para ${hosts.join(", ")} → ${dial}`);
  }

  async deleteRoute(projectId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
      return;
    }
    try {
      await this.adminRequest("DELETE", `/id/route-${projectId}`, "");
      console.log(`Caddy: ruta eliminada route-${projectId}`);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }

  private async readRoutes(): Promise<CaddyRoute[]> {
    const raw = await this.adminRequest("GET", ROUTES_PATH, "");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CaddyRoute[]) : [];
  }

  private adminRequest(method: string, requestPath: string, body: string): Promise<string> {
    const headers: Record<string, string | number> = {
      Host: "localhost:2019",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    };
    delete headers["Origin"];
    delete headers["origin"];
    console.log("Headers enviados a Caddy:", headers);

    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: "localhost",
          port: 2019,
          path: requestPath,
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on("end", () => {
            const responseBody = Buffer.concat(chunks).toString("utf8");
            const statusCode = res.statusCode ?? 0;
            if (statusCode >= 400) {
              reject(
                new Error(`Caddy request failed: ${statusCode} ${responseBody}`),
              );
              return;
            }
            resolve(responseBody);
          });
        },
      );
      request.on("error", reject);
      request.write(body);
      request.end();
    });
  }
}

type CaddyRoute = {
  "@id"?: string;
  handle?: Array<{
    handler?: string;
    upstreams?: Array<{ dial?: string }>;
  }>;
};

function proxiesToPanel(route: CaddyRoute): boolean {
  return (route.handle ?? []).some(
    (handler) =>
      handler.handler === "reverse_proxy" &&
      (handler.upstreams ?? []).some((upstream) => upstream.dial === PANEL_DIAL),
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

function normalizeAdminUrl(url: string): string {
  const normalized = url.trim().replace(/127\.0\.0\.1/g, "localhost");
  if (!normalized || !normalized.startsWith("http://localhost:2019")) {
    return DEFAULT_ADMIN_URL;
  }
  return normalized.replace(/\/+$/, "") || DEFAULT_ADMIN_URL;
}
