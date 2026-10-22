import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/database";
import { GITHUB_MOCK_PORT } from "./e2e/github-mock";

// Own port, never reused: another app on :3000 must not be what the tests hit.
const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const databaseUrl = e2eDatabaseUrl();
/** Bridge API token for e2e only; agents.spec.ts posts reports with it. */
export const E2E_BRIDGE_TOKEN = `e2e-bridge-token-${"0".repeat(32)}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: ["./e2e/global-setup.ts", "./e2e/github-mock.ts"],
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A production server, not `next dev`: Next allows one dev server per app folder, so a
    // running `pnpm dev` would block it. Env vars set here win over .env.
    command: `pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
      // GitHub is the local mock (e2e/github-mock.ts), whatever .env says; sync only on click.
      GITHUB_TOKEN: `github_pat_e2e_fixture_${"0".repeat(20)}`,
      GITHUB_API_URL: `http://127.0.0.1:${GITHUB_MOCK_PORT}`,
      GITHUB_SYNC_INTERVAL_MINUTES: "0",
      ADCC_BRIDGE_TOKEN: E2E_BRIDGE_TOKEN,
    },
  },
});
