import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
const candidates = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].filter(Boolean) as string[];
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "reports/playwright", open: "never" }],
  ],
  outputDir: "reports/browser-artifacts",
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: candidates.find((p) => existsSync(p)),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "node tools/test-server.ts",
    url: "http://127.0.0.1:4173/healthz",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
