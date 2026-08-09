import { defineConfig, devices } from "@playwright/test";

const federationWebServers = [
  {
    name: "rspack-remote",
    command: "corepack pnpm --dir examples/mixed-federation/remote-rspack preview",
    url: "http://127.0.0.1:3001/remoteEntry.js",
  },
  {
    name: "rsbuild-remote",
    command: "corepack pnpm --dir examples/mixed-federation/remote-rsbuild preview --strictPort",
    url: "http://127.0.0.1:3002/remoteEntry.js",
  },
  {
    name: "host-vite",
    command: "corepack pnpm --dir examples/mixed-federation/host-vite preview",
    url: "http://127.0.0.1:5173",
  },
] as const;

const issueWebServers = [
  {
    name: "issues-rspack-remote",
    command: "corepack pnpm --dir examples/mixed-federation-issues/remote-rspack preview",
    url: "http://127.0.0.1:3011/remoteEntry.js",
  },
  {
    name: "issues-rsbuild-remote",
    command:
      "corepack pnpm --dir examples/mixed-federation-issues/remote-rsbuild preview --strictPort",
    url: "http://127.0.0.1:3012/remoteEntry.js",
  },
  {
    name: "issues-host-vite",
    command: "corepack pnpm --dir examples/mixed-federation-issues/host-vite preview",
    url: "http://127.0.0.1:5183",
  },
] as const;

const multiInstanceWebServer = {
  name: "multi-instance-webpack",
  command: "node scripts/serve-dist.mjs examples/compatibility/webpack 3003",
  url: "http://127.0.0.1:3003/",
} as const;

const allFederationWebServers = [
  ...federationWebServers,
  ...issueWebServers,
  multiInstanceWebServer,
];

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
  webServer: allFederationWebServers.map((server) => ({
    // Prefix so Playwright webServer failure logs name the process.
    command: `echo "[mfdoctor-e2e:${server.name}] starting" && ${server.command}`,
    url: server.url,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  })),
});
