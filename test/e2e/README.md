# End-to-end tests

Playwright drives the healthy [`examples/mixed-federation`](../../examples/mixed-federation)
green path and the intentional [`examples/mixed-federation-issues`](../../examples/mixed-federation-issues)
red path. The latter proves that the known-bad host/remotes still boot and serve their
runtime entrypoints; the expected Doctor findings are asserted by `scripts/giga-smoke.mjs`.
It also runs a compatibility matrix. Webpack and Vite each emit two independent federation
containers from one production configuration. Rspack and Rsbuild remain covered by dedicated
single-instance adapter cells because their current federation plugins enforce one plugin per
compiler/configuration. The healthy mixed-federation path combines a Vite host with Rspack and
Rsbuild remotes.

## Run locally

```bash
pnpm test:e2e
```

`pnpm test:e2e` builds the repo, mixed-federation examples, and the four compatibility matrix
fixtures, then runs Playwright. Playwright starts the ten preview servers defined in
`playwright.config.ts`.
The recommendation-profile suite also runs the built CLI and real Vite adapter builds
against temporary projects to verify demo, production, CI, runtime-plugin, and exact-subpath-share behavior.

For the complete local gate, including nested, compatibility, standalone, CLI,
cross-app, and runtime checks, run:

```bash
pnpm test:giga
```

## Flake triage

Mixed-federation e2e is sensitive to preview-server boot order and remote entry
availability. When a run fails:

1. **Read the assertion message** — each expect includes the remote name and URL
   (for example `rspack remote (http://127.0.0.1:3001/remoteEntry.js)`).
2. **Check `test-results/` and `playwright-report/`** — traces, screenshots, and
   video are retained on failure (`trace: retain-on-failure`).
3. **Confirm which webServer failed** — `playwright.config.ts` starts the healthy,
   intentional-findings, and multi-instance servers. A timeout on
   `webServer.url` means that preview process never became ready. Startup logs
   are prefixed with `[mfdoctor-e2e:<name>]`.
4. **Inspect CI artifacts** — the `playwright-failures` artifact uploads
   `test-results/` and `playwright-report/` from `.github/workflows/e2e.yml`.
5. **Retry behavior** — CI runs with `retries: 2` to absorb short-lived boot
   races. Local runs use `retries: 0` so failures surface immediately.

### Manual server checks

With preview servers running (or after a failed run leaves them up locally).
Probes use `127.0.0.1` (not `localhost`) to match the IPv4 bind used in CI:

```bash
curl -fsS http://127.0.0.1:3001/remoteEntry.js | head
curl -fsS http://127.0.0.1:3002/remoteEntry.js | head
curl -fsS http://127.0.0.1:5173/
curl -fsS http://127.0.0.1:3003/
curl -fsS http://127.0.0.1:3004/dist/first/firstRemoteEntry.js | head
curl -fsS http://127.0.0.1:3005/dist/firstRemoteEntry.js | head
curl -fsS http://127.0.0.1:3006/dist/firstRemoteEntry.js | head
```

### Common causes

- **Remote entry 404** — example not built; run `pnpm test:examples` or full
  `pnpm test:e2e` so builds run first.
- **Port already in use** — stop stale preview processes on 3001, 3002, 3003, 3004, 3005, 3006, 5173, or 5183.
- **`localhost` vs `127.0.0.1`** — preview servers bind IPv4 loopback; probing
  `localhost` can fail in CI when it resolves to `::1`.
- **Slow CI cold start** — webServer timeout is 120s; readiness polling in
  `test/e2e/helpers/federation-servers.ts` waits up to 30s per attempt before
  the browser navigates.
