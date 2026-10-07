const PLACEHOLDERS = new Set([
  "",
  "TU_CLIENT_ID_REAL",
  "TU_CLIENT_SECRET_REAL",
]);

export function githubOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.AUTH_GITHUB_ID?.trim() ?? "";
  const clientSecret = process.env.AUTH_GITHUB_SECRET?.trim() ?? "";
  if (PLACEHOLDERS.has(clientId) || PLACEHOLDERS.has(clientSecret)) {
    return null;
  }
  return { clientId, clientSecret };
}
