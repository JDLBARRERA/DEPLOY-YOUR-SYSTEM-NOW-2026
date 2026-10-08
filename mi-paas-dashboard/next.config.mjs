import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: dashboardRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    // Todo /backend pasa por el proxy local (upstream opcional + fallback SQLite/file).
    return [
      {
        source: "/backend/deployments/:projectId/logs",
        destination: "/api/log-stream/:projectId",
      },
      {
        source: "/backend/:path*",
        destination: "/api/backend/:path*",
      },
    ];
  },
};

export default nextConfig;
