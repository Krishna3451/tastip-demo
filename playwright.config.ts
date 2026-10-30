import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT } from "./tests/e2e/environment";
import { prepareDisposableE2EStore } from "./tests/support/disposable-e2e-store";

const dataDirectory = prepareDisposableE2EStore(E2E_ORIGIN);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  // Each invocation owns its traces; a failed parallel startup must not erase another run.
  outputDir: join(tmpdir(), `tastip-browser-artifacts-${randomUUID()}`),
  use: {
    baseURL: E2E_ORIGIN,
    headless: true,
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  webServer: {
    command: `bun --cwd apps/web dev --port ${E2E_PORT}`,
    url: E2E_ORIGIN,
    env: {
      TASTIP_E2E_SERVER: "1",
      TASTIP_DATA_DIR: dataDirectory,
    },
    reuseExistingServer: process.env.TASTIP_E2E_REUSE_SERVER === "1" && !process.env.CI,
    timeout: 120_000,
  },
});
