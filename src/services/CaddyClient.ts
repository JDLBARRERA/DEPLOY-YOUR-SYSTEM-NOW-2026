const DEFAULT_ADMIN_URL = "http://127.0.0.1:2019";

export class CaddyClient {
  constructor(
    private readonly adminUrl = process.env.CADDY_ADMIN_URL ?? DEFAULT_ADMIN_URL,
  ) {}

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
      Origin: this.adminUrl,
    };
    const replace = await fetch(`${this.adminUrl}/id/route-${projectId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(route),
    });

    if (replace.ok) {
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
  }
}
