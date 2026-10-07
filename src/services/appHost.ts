export function appDomain(): string {
  const domain = process.env.APP_DOMAIN?.trim();
  return domain && domain.length > 0 ? domain : "localhost";
}

export function appHost(name: string): string {
  return `${name}.${appDomain()}`;
}

export function appPublicUrl(name: string): string {
  const host = appHost(name);
  const scheme = appDomain() === "localhost" ? "http" : "https";
  return `${scheme}://${host}`;
}

export function publicUrlForHost(host: string): string {
  const scheme = host.endsWith(".localhost") ? "http" : "https";
  return `${scheme}://${host}`;
}
