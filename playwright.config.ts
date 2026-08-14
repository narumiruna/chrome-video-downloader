import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? "github" : "list",
  webServer: {
    command: "node e2e/fixture-server.mjs",
    url: "http://127.0.0.1:4173/direct.html",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
