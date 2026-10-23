import type { NextConfig } from "next";

// Baseline response headers for every route (pages, API and static assets).
//  - X-Frame-Options: the app must never be embedded in another site (clickjacking).
//  - Referrer-Policy: send only the origin cross-site, nothing on downgrades.
// CSP is opt-in until proven against the 3D globe and streaming: TERRITORY_CSP=report-only | enforce (see docs/DEPLOY.md).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Next inlines its bootstrap/streaming scripts; nonces would force fully dynamic rendering
  "style-src 'self' 'unsafe-inline'", // motion and the WebGL canvas set inline styles
  "img-src 'self' data: blob:", // data: = the film-grain SVG background
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const cspHeader = process.env.TERRITORY_CSP === "enforce" ? "Content-Security-Policy" : process.env.TERRITORY_CSP === "report-only" ? "Content-Security-Policy-Report-Only" : null;

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          ...(cspHeader ? [{ key: cspHeader, value: CSP }] : []),
        ],
      },
    ];
  },
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
