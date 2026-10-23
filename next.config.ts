import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Private Qloo cache seed, present only in CLI deployments (gitignored); see docs/ARCHITECTURE.md.
  outputFileTracingIncludes: { "/api/agent": ["./.private/qloo-cache/**/*"] },
  // Secrets come from the host's environment, never from files shipped in the function bundle.
  outputFileTracingExcludes: { "*": ["./.env", "./.env.*"] },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
