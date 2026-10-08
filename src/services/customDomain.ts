import { appDomain } from "./appHost.js";

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeCustomDomain(value: string): string {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.includes("://") || host.includes("/") || host.includes(":") || /\s/.test(host)) {
    throw new Error("Escribe solo el dominio, por ejemplo app.cliente.com");
  }
  if (!HOSTNAME.test(host)) {
    throw new Error("customDomain no es un dominio válido");
  }
  const platform = appDomain().toLowerCase();
  if (platform !== "localhost" && (host === platform || host === `www.${platform}`)) {
    throw new Error("Ese dominio pertenece al panel");
  }
  return host;
}

export function routeHosts(defaultHost: string, customDomain?: string | null): string[] {
  const hosts = [defaultHost.trim().toLowerCase()];
  const extra = customDomain?.trim().toLowerCase();
  if (extra && extra !== hosts[0]) {
    hosts.push(extra);
  }
  return hosts;
}
