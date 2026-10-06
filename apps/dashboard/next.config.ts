import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dashboardRoot, "../..");

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["@prisma/client"],
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
