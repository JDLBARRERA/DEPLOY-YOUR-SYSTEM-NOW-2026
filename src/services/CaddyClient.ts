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

    try {
      await this.adminRequest("PATCH", `/id/route-${projectId}`, body);
      console.log(
        `Caddy: ruta actualizada para ${host} → host.docker.internal:${port}`,
      );
      return;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    await this.adminRequest("POST", "/config/apps/http/servers/paas/routes/0", body);
    console.log(
      `Caddy: ruta creada para ${host} → host.docker.internal:${port}`,
    );
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
