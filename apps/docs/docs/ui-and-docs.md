# Documentation design

The docs site runs on Rspress 2 (`@rspress/core`), matching the Module
Federation website stack. Branding reuses the official federation mark with a
Doctor diagnostic accent (`docs/public/doctor-*.svg`) plus a generated tooling
icon for hero and social surfaces.

## Site origin (`SITE_ORIGIN`)

OG and Twitter image URLs in the built HTML are absolute. They use:

```bash
SITE_ORIGIN=https://module-federation.github.io   # default
```

That default matches the planned Module Federation org docs host and the
`DOCTOR_DOCS_ORIGIN` constant used in terminal/SARIF rule links
(`src/reporters.ts`). The GitHub repository currently lives under
`tonoizer/module-federation-doctor`; until an org transfer, keep the default
unless you deploy docs elsewhere — then set `SITE_ORIGIN` to that public
origin (no trailing slash) for the docs build.

Navigation IA is Start → CLI → Rules → Examples → Limitations, with deeper
guides under More guides. Top nav: **Start** (`/setup`) and **Rules**
(`/rules/`), including the Runtime rule group.

## What Doctor adopts

- status-first error/warning/info counts in the terminal reporter,
- expandable evidence in JSON/SARIF artifacts,
- light and dark system themes on the docs site,
- local docs search and generated reference pages,
- machine-readable reports you can attach to CI (`report.json`, `results.sarif`).

Doctor no longer ships an HTML dashboard or `--ui` server. Terminal output plus
JSON/SARIF are the supported report surfaces. The `buildUiPayload` API and
`schemas/ui.schema.json` stay as a programmatic federation graph contract for
custom tooling — not an HTML UI (see [report schemas](./report-schemas.md)).

## What Doctor does not copy

Vitest's UI is a live test runner with WebSocket state, rerun controls, source
editing, coverage, and a module graph. Doctor does not need write controls or a
long-running watch loop for diagnostics. Adding those would enlarge the attack
surface and make a simple build diagnostic harder to archive.

Sources:
[Vitest docs config](https://github.com/vitest-dev/vitest/blob/a31f86af738b2979905f6a61eb5d8848d489eed7/docs/.vitepress/config.ts)
and
[Vitest dashboard](https://github.com/vitest-dev/vitest/blob/a31f86af738b2979905f6a61eb5d8848d489eed7/packages/ui/client/components/Dashboard.vue).
