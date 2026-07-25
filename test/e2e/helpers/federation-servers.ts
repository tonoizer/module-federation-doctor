export type FederationServer = {
  name: string;
  /** HTTP readiness URL (never a downloadable asset path — avoids insecure-download alerts). */
  url: string;
  /** Human-facing entry URL used in failure messages. */
  entryUrl: string;
};

/** Preview servers started by `playwright.config.ts` webServer entries. */
export const FEDERATION_SERVERS: FederationServer[] = [
  {
    name: "rspack remote",
    url: "http://localhost:3001/",
    entryUrl: "http://localhost:3001/remoteEntry.js",
  },
  {
    name: "rsbuild remote",
    url: "http://localhost:3002/",
    entryUrl: "http://localhost:3002/remoteEntry.js",
  },
  {
    name: "host (vite)",
    url: "http://localhost:5173/",
    entryUrl: "http://localhost:5173/",
  },
];

export async function waitForFederationServers(
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
        // Probe the server root (not remoteEntry.js) so readiness polling is not
        // flagged as an insecure download of a sensitive file over HTTP.
        // Any HTTP response means the preview process is accepting connections;
        // Playwright's webServer already gated on remoteEntry.js before tests start.
        const response = await fetch(server.url);
        if (response.status >= 500) {
          lastFailures.push(
            `${server.name} (${server.entryUrl}): HTTP ${response.status}`,
          );
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
