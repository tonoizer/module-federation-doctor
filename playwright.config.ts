import { defineConfig, devices } from "@playwright/test";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rawPortOffset = process.env.MFDOCTOR_E2E_PORT_OFFSET;
const portOffset = Number(rawPortOffset ?? 0);
if (!Number.isInteger(portOffset) || portOffset < 0 || portOffset > 20_000)
  throw new Error("MFDOCTOR_E2E_PORT_OFFSET must be an integer between 0 and 20000");
const e2ePort = (basePort: number) => basePort + portOffset;
const e2eUrl = (basePort: number, pathname = "") =>
  `http://127.0.0.1:${e2ePort(basePort)}${pathname}`;

const federationWebServers = [
  {
    name: "rspack-remote",
    command: `${pnpmCommand} --dir examples/mixed-federation/remote-rspack preview`,
    url: e2eUrl(3001, "/remoteEntry.js"),
  },
  {
    name: "rsbuild-remote",
    command: `${pnpmCommand} --dir examples/mixed-federation/remote-rsbuild preview`,
    url: e2eUrl(3002, "/remoteEntry.js"),
  },
  {
    name: "host-vite",
    command: `${pnpmCommand} --dir examples/mixed-federation/host-vite preview`,
    url: e2eUrl(5173),
  },
] as const;

const issueWebServers = [
  {
    name: "issues-rspack-remote",
    command: `${pnpmCommand} --dir examples/mixed-federation-issues/remote-rspack preview`,
    url: e2eUrl(3011, "/remoteEntry.js"),
  },
  {
    name: "issues-rsbuild-remote",
    command: `${pnpmCommand} --dir examples/mixed-federation-issues/remote-rsbuild preview`,
    url: e2eUrl(3012, "/remoteEntry.js"),
  },
  {
    name: "issues-host-vite",
    command: `${pnpmCommand} --dir examples/mixed-federation-issues/host-vite preview`,
    url: e2eUrl(5183),
  },
] as const;

const allFederationWebServers = [...federationWebServers, ...issueWebServers];

export default defineConfig({
  testDir: "test/e2e",
  outputDir: "test-results",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: e2eUrl(5173),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: allFederationWebServers.map((server) => ({
    // Prefix so Playwright webServer failure logs name the process.
    command: `echo "[mfdoctor-e2e:${server.name}] starting" && ${server.command}`,
    url: server.url,
    // run-e2e.mjs allocates a free range; never reuse an unrelated local process.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  })),
});
