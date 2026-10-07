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

    const headers = {
      "Content-Type": "application/json",
      Host: "localhost:2019",
      Origin: "http://localhost:2019",
    };

    const replace = await fetch(`${this.adminUrl}/id/route-${projectId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(route),
    });

    if (replace.ok) {
      console.log(
        `Caddy: ruta actualizada para ${host} → host.docker.internal:${port}`,
      );
      return;
    }

    if (replace.status !== 404) {
      throw new Error(
        `Caddy route update failed: ${replace.status} ${await replace.text()}`,
      );
    }

    const created = await fetch(
      `${this.adminUrl}/config/apps/http/servers/paas/routes/0`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(route),
      },
    );

    if (!created.ok) {
      throw new Error(
        `Caddy route create failed: ${created.status} ${await created.text()}`,
      );
    }

    console.log(
      `Caddy: ruta creada para ${host} → host.docker.internal:${port}`,
    );
  }
}

function normalizeAdminUrl(url: string): string {
  return url.trim().replace(/127\.0\.0\.1/g, "localhost") || DEFAULT_ADMIN_URL;
}
