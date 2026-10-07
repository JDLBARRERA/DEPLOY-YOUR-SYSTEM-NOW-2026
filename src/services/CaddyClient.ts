import http from "node:http";

const DEFAULT_ADMIN_URL = "http://localhost:2019";

export class CaddyClient {
  private readonly adminUrl: string;

  constructor(adminUrl = process.env.CADDY_ADMIN_URL ?? DEFAULT_ADMIN_URL) {
    this.adminUrl = normalizeAdminUrl(adminUrl);
  }

  async upsertRoute(projectId: string, host: string, port: number): Promise<void> {
    const route = {
      "@id": `route-${projectId}`,
      match: [{ host: [host] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: `host.docker.internal:${port}` }],
        },
      ],
      terminal: true,
    };
    const body = JSON.stringify(route);

    const replace = await this.adminRequest("PATCH", `/id/route-${projectId}`, body);
    if (replace.statusCode >= 200 && replace.statusCode < 300) {
      console.log(
        `Caddy: ruta actualizada para ${host} → host.docker.internal:${port}`,
      );
      return;
    }

    if (replace.statusCode !== 404) {
      throw new Error(
        `Caddy route update failed: ${replace.statusCode} ${replace.body}`,
      );
    }

    const created = await this.adminRequest(
      "POST",
      "/config/apps/http/servers/paas/routes/0",
      body,
    );

    if (created.statusCode < 200 || created.statusCode >= 300) {
      throw new Error(
        `Caddy route create failed: ${created.statusCode} ${created.body}`,
      );
    }

    console.log(
      `Caddy: ruta creada para ${host} → host.docker.internal:${port}`,
    );
  }

  private adminRequest(
    method: string,
    path: string,
    body: string,
  ): Promise<{ statusCode: number; body: string }> {
    const headers: Record<string, string> = {
      Host: "localhost:2019",
      "Content-Type": "application/json",
    };
    delete headers.Origin;
    delete headers.origin;
    console.log("Headers enviados a Caddy:", headers);

    const url = new URL(path, this.adminUrl);
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 2019,
          path: url.pathname + url.search,
          method,
          headers: {
            ...headers,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      request.on("error", reject);
      request.write(body);
      request.end();
    });
  }
}

function normalizeAdminUrl(url: string): string {
  const normalized = url.trim().replace(/127\.0\.0\.1/g, "localhost");
  if (!normalized || !normalized.startsWith("http://localhost:2019")) {
    return DEFAULT_ADMIN_URL;
  }
  return normalized.replace(/\/+$/, "") || DEFAULT_ADMIN_URL;
}
