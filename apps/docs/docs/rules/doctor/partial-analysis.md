# `doctor/partial-analysis`

- Category: **tooling**
- Default severity: **warning**

## Issue

Missing facts, unresolved dynamic imports, unreadable source files recorded in `imports.sourceReadFailures`, or omitted workspace projects reduce confidence and can hide relevant findings. Source read failures make project or workspace input `unknown`; a pure analysis-budget cutoff is `partial`. Both incomplete workspace cases use exit code 2, and source-derived `federation/ghost-shares` findings are suppressed until the input is complete.

## How to fix it

When MF options are missing, pass them explicitly. On Vite, missing `mf-manifest.json` / `mf-stats.json` usually means enable `manifest: true` — not missing options. Fix source permissions or transient read races when `imports.sourceReadFailures` is present, or raise the analysis budget when only a budget cutoff made the workspace `partial`. Prefer string-literal dynamic imports or an opt-in runtime trace when analysis is incomplete.

Suppress or retarget with `rules["doctor/partial-analysis"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/index.html)
