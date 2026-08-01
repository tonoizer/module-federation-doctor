# `doctor/partial-analysis`

- Category: **tooling**
- Default severity: **warning**

## Issue

Missing facts or unresolved dynamic imports reduce confidence and can hide relevant findings.

## How to fix it

When Module Federation options were not passed to Doctor, pass them explicitly.

On Vite / Rolldown-Vite, `@module-federation/vite` does **not** emit `mf-manifest.json` or `mf-stats.json` unless `manifest: true` is set. Missing those artifacts with options already present is expected — enable `manifest: true` rather than “pass explicit MF options.” Webpack-style compilation `stats.json` is not required for Vite.

Prefer string-literal dynamic imports or an opt-in runtime trace when analysis is incomplete. Run Doctor through the bundler adapter after emit for full artifact facts.

Suppress or retarget with `rules["doctor/partial-analysis"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/index.html)
