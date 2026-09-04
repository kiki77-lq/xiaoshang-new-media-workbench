import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    serviceWorkers: "allow"
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4173/api/v1/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      WORKBENCH_HOST: "127.0.0.1",
      WORKBENCH_PORT: "4173",
      WORKBENCH_DATA_DIR: "/tmp/xiaoshang-phase-2-playwright-data"
    }
  }
});
