# Documentation design

The docs site runs on Rspress 2 (`@rspress/core`), matching the Module
Federation website stack. Branding reuses the official federation mark with a
Doctor diagnostic accent (`docs/public/doctor-*.svg`) plus a generated tooling
icon for hero and social surfaces.

## What Doctor adopts

- status-first error/warning/info counts in the terminal reporter,
- expandable evidence in JSON/SARIF artifacts,
- light and dark system themes on the docs site,
- local docs search and generated reference pages,
- machine-readable reports you can attach to CI (`report.json`, `results.sarif`).

Doctor no longer ships an HTML dashboard or `--ui` server. Terminal output plus
JSON/SARIF are the supported report surfaces.

## What Doctor does not copy

Vitest's UI is a live test runner with WebSocket state, rerun controls, source
editing, coverage, and a module graph. Doctor does not need write controls or a
long-running watch loop for diagnostics. Adding those would enlarge the attack
surface and make a simple build diagnostic harder to archive.

Sources:
[Vitest docs config](https://github.com/vitest-dev/vitest/blob/a31f86af738b2979905f6a61eb5d8848d489eed7/docs/.vitepress/config.ts)
and
[Vitest dashboard](https://github.com/vitest-dev/vitest/blob/a31f86af738b2979905f6a61eb5d8848d489eed7/packages/ui/client/components/Dashboard.vue).
