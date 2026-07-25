import type { APIRequestContext } from "@playwright/test";

export type FederationServer = {
  name: string;
  /** HTTP readiness probe URL (server root — not a downloadable asset). */
  url: string;
  /** Human-facing entry URL used in failure messages. */
  entryUrl: string;
};

/**
 * Preview servers started by `playwright.config.ts` webServer entries.
 * Use 127.0.0.1 (not localhost) so Node/CI probes hit the same IPv4 bind as
 * the rspack static server and Vite/Rsbuild `--host 127.0.0.1` previews.
 */
export const FEDERATION_SERVERS: FederationServer[] = [
  {
    name: "rspack remote",
    url: "http://127.0.0.1:3001/",
    entryUrl: "http://127.0.0.1:3001/remoteEntry.js",
  },
  {
    name: "rsbuild remote",
    url: "http://127.0.0.1:3002/",
    entryUrl: "http://127.0.0.1:3002/remoteEntry.js",
  },
  {
    name: "host (vite)",
    url: "http://127.0.0.1:5173/",
    entryUrl: "http://127.0.0.1:5173/",
  },
];

export async function waitForFederationServers(
  request: APIRequestContext,
  servers: FederationServer[] = FEDERATION_SERVERS,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let lastFailures: string[] = [];

  while (Date.now() < deadline) {
    lastFailures = [];
    for (const server of servers) {
      try {
        // Probe via Playwright's request client (same stack as webServer), not
        // global fetch — Node fetch to `localhost` can miss IPv4-only binds in CI.
        const response = await request.get(server.url);
        if (response.status() >= 500) {
          lastFailures.push(`${server.name} (${server.entryUrl}): HTTP ${response.status()}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastFailures.push(`${server.name} (${server.entryUrl}): ${message}`);
      }
    }
    if (lastFailures.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Federation preview servers not ready after ${timeoutMs}ms:\n${lastFailures.join("\n")}`,
  );
}
