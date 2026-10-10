import { defineConfig } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.JIANTI_E2E_DATA_DIR ?? `tmp/browser-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
process.env.JIANTI_E2E_DATA_DIR = dataDir;
const browsers = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"];
const executablePath = browsers.find(candidate => candidate && existsSync(candidate));

export default defineConfig({
  testDir: "./tests/browser", timeout: 30000, workers: 1, retries: 0,
  outputDir: "tmp/browser-results", reporter: "list",
  use: { baseURL: "http://127.0.0.1:3189", headless: true, launchOptions: { executablePath }, trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/run-local.mjs --web-port=3189 --api-port=3289",
    url: "http://127.0.0.1:3189/api/ready", timeout: 90000, reuseExistingServer: false,
    env: { JIANTI_DATA_DIR: dataDir, JIANTI_DEPLOYMENT_MODE: "local", JIANTI_WEB_HOST: "127.0.0.1" },
  },
});
