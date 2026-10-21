import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const systemBrowser = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
export default defineConfig({
  testDir: "./e2e",
  outputDir: "artifacts/browser-results",
  timeout: 60000,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(existsSync(systemBrowser) ? { executablePath: systemBrowser } : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
