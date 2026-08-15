# End-to-end tests

Playwright drives the healthy [`examples/mixed-federation`](../../examples/mixed-federation)
green path and the intentional [`examples/mixed-federation-issues`](../../examples/mixed-federation-issues)
red path. The full E2E gate also builds the nested and compatibility matrices,
checks cross-app behavior, and verifies the expected MFDoctor findings before the
browser run. It also loads the production-built [`examples/compatibility/webpack`](../../examples/compatibility/webpack)
fixture in a browser and executes two independent Webpack federation containers from the
same compilation. The latter proves that the known-bad host/remotes still boot and serve their
runtime entrypoints; the expected MFDoctor findings are asserted by `scripts/giga-smoke.mjs`.
The compatibility matrix includes Webpack and Vite multi-instance containers plus dedicated
single-instance Rspack and Rsbuild adapter cells because their current federation plugins
enforce one plugin per compiler/configuration. The healthy mixed-federation path combines a
Vite host with Rspack and Rsbuild remotes.

## Run locally

```bash
vp exec playwright install chromium
vp run test:e2e
```

`vp run test:e2e` builds the package and the full local federation matrix, including the
multi-instance Webpack/Vite fixtures and Rspack/Rsbuild adapter cells, then runs Playwright.
It prints the selected ten-port range, automatically moves to a free range when another
local app or SSH tunnel owns the defaults, and starts the ten servers defined in
`playwright.config.ts`. The browser installation is a one-time setup per machine.
Because package and example builds share outputs within one checkout, the runner
serializes full gates for that checkout; separate worktrees can still run independently.
The recommendation-profile suite also runs the built CLI and real Vite adapter builds
against temporary projects to verify demo, production, CI, runtime-plugin, and exact-subpath-share behavior.

For a focused Playwright rerun, use the same `MFDOCTOR_E2E_PORT_OFFSET` that the
build used. Direct Playwright runs do not choose a port range or rebuild the
examples:

```bash
E2E_OFFSET=0 # replace 0 with the offset printed by vp run test:e2e
MFDOCTOR_E2E_PORT_OFFSET="$E2E_OFFSET" vp exec playwright test
```

For compatibility with older automation, the former command remains available as
an alias:

```bash
vp run test:giga
```

It runs the same full E2E gate; there is no separate Giga test suite anymore.

## Flake triage

Mixed-federation e2e is sensitive to preview-server boot order and remote entry
availability. When a run fails:

1. **Read the assertion message** — each expect includes the remote name and URL
   (for example `rspack remote (http://127.0.0.1:3001/remoteEntry.js)`).
2. **Check `test-results/` and `playwright-report/`** — traces, screenshots, and
   video are retained on failure (`trace: retain-on-failure`).
3. **Confirm which webServer failed** — `playwright.config.ts` starts ten
   servers: three healthy (`rspack-remote`, `rsbuild-remote`, `host-vite`),
   three intentional-issues servers (`issues-rspack-remote`,
   `issues-rsbuild-remote`, `issues-host-vite`) and four compatibility matrix
   servers (`multi-instance-webpack`, `multi-instance-vite`, `adapter-rspack`,
   `adapter-rsbuild`). A timeout on `webServer.url` means that preview process
   never became ready. Startup logs are prefixed with `[mfdoctor-e2e:<name>]`.
4. **Inspect CI artifacts** — the `playwright-failures` artifact uploads
   `test-results/` and `playwright-report/` from `.github/workflows/e2e.yml`.
5. **Retry behavior** — CI runs with `retries: 2` to absorb short-lived boot
   races. Local runs use `retries: 0` so failures surface immediately.

### Manual server checks

With preview servers running, use the ports printed by `vp run test:e2e`. The
defaults below apply only when the runner reports offset `0`. Probes use
`127.0.0.1` (not `localhost`) to match the IPv4 bind used in CI:

```bash
curl -fsS http://127.0.0.1:3001/remoteEntry.js | head
curl -fsS http://127.0.0.1:3002/remoteEntry.js | head
curl -fsS http://127.0.0.1:5173/
curl -fsS http://127.0.0.1:3003/
curl -fsS http://127.0.0.1:3004/dist/first/firstRemoteEntry.js | head
curl -fsS http://127.0.0.1:3005/dist/firstRemoteEntry.js | head
curl -fsS http://127.0.0.1:3006/dist/firstRemoteEntry.js | head
curl -fsS http://127.0.0.1:3011/remoteEntry.js | head
curl -fsS http://127.0.0.1:3012/remoteEntry.js | head
curl -fsS http://127.0.0.1:5183/ | head
```

### Common causes

- **Remote entry 404** — example not built; run `vp run test:examples` or full
  `vp run test:e2e` so builds run first.
- **Port already in use** — the full runner automatically selects another range;
  if you supplied `MFDOCTOR_E2E_PORT_OFFSET` manually, clear it or choose a free
  offset.
- **`localhost` vs `127.0.0.1`** — preview servers bind IPv4 loopback; probing
  `localhost` can fail in CI when it resolves to `::1`.
- **Slow CI cold start** — webServer timeout is 120s; readiness polling in
  `test/e2e/helpers/federation-servers.ts` waits up to 30s per attempt before
  the browser navigates.
