import { defineConfig, devices } from "@playwright/test";

const federationWebServers = [
  {
    name: "rspack-remote",
    command: "pnpm --dir examples/mixed-federation/remote-rspack preview",
    url: "http://127.0.0.1:3001/remoteEntry.js",
  },
  {
    name: "rsbuild-remote",
    command: "pnpm --dir examples/mixed-federation/remote-rsbuild preview",
    url: "http://127.0.0.1:3002/remoteEntry.js",
  },
  {
    name: "host-vite",
    command: "pnpm --dir examples/mixed-federation/host-vite preview",
    url: "http://127.0.0.1:5173",
  },
] as const;

export default defineConfig({
  testDir: "test/e2e",
  outputDir: "test-results",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: federationWebServers.map((server) => ({
    // Prefix so Playwright webServer failure logs name the process.
    command: `echo "[mfdoctor-e2e:${server.name}] starting" && ${server.command}`,
    url: server.url,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  })),
});
