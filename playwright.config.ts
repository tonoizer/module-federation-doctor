import { defineConfig, devices } from "@playwright/test";

const vitePlus = process.platform === "win32" ? "vp.cmd" : "vp";
const previewCommand = (filter: string, extraArgs = "") =>
  `${vitePlus} run --filter ${filter} preview${extraArgs ? ` ${extraArgs}` : ""}`;
const rawPortOffset = process.env.MFDOCTOR_E2E_PORT_OFFSET;
const portOffset = Number(rawPortOffset ?? 0);
if (!Number.isInteger(portOffset) || portOffset < 0 || portOffset > 20_000)
  throw new Error("MFDOCTOR_E2E_PORT_OFFSET must be an integer between 0 and 20000");
const e2ePort = (basePort: number) => basePort + portOffset;
const e2eUrl = (basePort: number, pathname = "") =>
  `http://127.0.0.1:${e2ePort(basePort)}${pathname}`;
const wrapServerCommand = (command: string) => `node scripts/run-e2e-server.mjs -- ${command}`;

const federationWebServers = [
  {
    name: "rspack-remote",
    command: previewCommand("@mfdoctor-example/remote-rspack"),
    url: e2eUrl(3001, "/remoteEntry.js"),
  },
  {
    name: "rsbuild-remote",
    command: previewCommand("@mfdoctor-example/remote-rsbuild", "--strictPort"),
    url: e2eUrl(3002, "/remoteEntry.js"),
  },
  {
    name: "host-vite",
    command: previewCommand("@mfdoctor-example/host-vite"),
    url: e2eUrl(5173),
  },
] as const;

const issueWebServers = [
  {
    name: "issues-rspack-remote",
    command: previewCommand("@mfdoctor-example-issues/remote-rspack"),
    url: e2eUrl(3011, "/remoteEntry.js"),
  },
  {
    name: "issues-rsbuild-remote",
    command: previewCommand("@mfdoctor-example-issues/remote-rsbuild", "--strictPort"),
    url: e2eUrl(3012, "/remoteEntry.js"),
  },
  {
    name: "issues-host-vite",
    command: previewCommand("@mfdoctor-example-issues/host-vite"),
    url: e2eUrl(5183),
  },
] as const;

const multiInstanceWebServers = [
  {
    name: "multi-instance-webpack",
    command: "node scripts/serve-dist.mjs examples/compatibility/webpack 3003",
    url: e2eUrl(3003),
  },
  {
    name: "multi-instance-vite",
    command: "node scripts/serve-dist.mjs examples/compatibility/vite-multi-instance 3004",
    url: e2eUrl(3004),
  },
  {
    name: "adapter-rspack",
    command: "node scripts/serve-dist.mjs examples/compatibility/rspack-adapter 3005",
    url: e2eUrl(3005),
  },
  {
    name: "adapter-rsbuild",
    command: "node scripts/serve-dist.mjs examples/compatibility/rsbuild-adapter 3006",
    url: e2eUrl(3006),
  },
] as const;

const allFederationWebServers = [
  ...federationWebServers,
  ...issueWebServers,
  ...multiInstanceWebServers,
];

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
    command: `echo "[mfdoctor-e2e:${server.name}] starting" && ${wrapServerCommand(server.command)}`,
    url: server.url,
    // run-e2e.mjs allocates a free range; never reuse an unrelated local process.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  })),
});
