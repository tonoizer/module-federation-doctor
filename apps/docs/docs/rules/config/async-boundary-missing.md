# `config/async-boundary-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

A host entry that synchronously imports non-eager shared packages can hit RUNTIME-005 (`loadShareSync`) because Module Federation needs an async boundary before shared negotiation finishes.

## How to fix it

Move app startup behind a dynamic import (for example `import('./bootstrap')`), enable `experiments.asyncStartup`, or mark those shared packages `eager: true` when intentional.

Suppress or retarget with `rules["config/async-boundary-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/troubleshooting/runtime.html#runtime-005)
- [Official source](https://module-federation.io/configure/experiments.html)
- [Official source](https://module-federation.io/configure/shared.html)
