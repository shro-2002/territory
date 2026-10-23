import { defineConfig } from "@playwright/test";

const PORT = 3101;

// Runs against the labelled mock backend (empty QLOO_API_KEY) so CI never spends Qloo quota.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx next build && npx next start --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { QLOO_API_KEY: "" },
  },
});
