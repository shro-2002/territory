import { defineConfig } from "@playwright/test";

const PORT = 3101;

// Runs against the labelled mock backend (empty QLOO_API_KEY) so CI never spends Qloo quota, and without
// Upstash so test runs never consume the shared production rate-limit counters (in-memory limiter instead).
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx next build && npx next start --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { QLOO_API_KEY: "", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", TERRITORY_TEST: "1" },
  },
});
