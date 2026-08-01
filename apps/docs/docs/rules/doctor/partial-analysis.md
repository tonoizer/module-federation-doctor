# `doctor/partial-analysis`

- Category: **tooling**
- Default severity: **warning**

## Issue

Missing facts or unresolved dynamic imports reduce confidence and can hide relevant findings.

## How to fix it

When MF options are missing, pass them explicitly. On Vite, missing `mf-manifest.json` / `mf-stats.json` usually means enable `manifest: true` — not missing options. Prefer string-literal dynamic imports or an opt-in runtime trace when analysis is incomplete.

Suppress or retarget with `rules["doctor/partial-analysis"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/index.html)
