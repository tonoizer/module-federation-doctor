# UI and documentation design

The docs site runs on Rspress 2 (`@rspress/core`), matching the Module
Federation website stack. Branding reuses the official federation mark with a
Doctor diagnostic accent (`docs/public/doctor-*.svg`) plus a generated tooling
icon for hero and social surfaces.

Vitest provides useful design ideas, but Doctor has a different job.

## What Doctor adopts

- status-first error/warning/info counts,
- fast filters and search,
- expandable evidence,
- light and dark system themes,
- local docs search and generated reference pages,
- one report file that can be attached to CI,
- an optional `--ui` dashboard that opens the same portable report on loopback.

The implementation is a static `report.html`. It makes no network requests,
loads no remote assets, and renders only Doctor's redacted report plus derived
federation graphs. This keeps it safe and portable.

## Live `--ui` server

`mfdoctor check --ui` and `mfdoctor federation … --ui` force HTML output, then
serve `.mf/doctor/report.html` on `127.0.0.1` (default port `51205`) and open a
browser. The server is read-only: static files only, no write endpoints, no
remote execution, and no WebSocket rerun controls.

Hold is skipped when `MFDOCTOR_UI_NO_HOLD=1` (useful for tests).

## Dashboard views

- Findings: filters, search, expandable evidence
- Remote graph: project → remote wiring
- Shared: shared dependency graph across projects
- Orchestration: exposes, consumes, external-runtime provider links
- Module info: per-project federation tables

Graph views follow the Module Federation Chrome DevTools layout patterns
(React Flow + dagre) but run from Doctor's offline report payload, not browser
runtime globals.

## What Doctor does not copy

Vitest's UI is a live test runner with WebSocket state, rerun controls, source
editing, coverage, and a module graph. Doctor does not need write controls or a
long-running watch loop for diagnostics. Adding those would enlarge the attack
surface and make a simple build diagnostic harder to archive.

Sources:
[Vitest docs config](https://github.com/vitest-dev/vitest/blob/a31f86af738b2979905f6a61eb5d8848d489eed7/docs/.vitepress/config.ts)
and
[Vitest dashboard](https://github.com/vitest-dev/vitest/blob/a31f86af738b2979905f6a61eb5d8848d489eed7/packages/ui/client/components/Dashboard.vue).
