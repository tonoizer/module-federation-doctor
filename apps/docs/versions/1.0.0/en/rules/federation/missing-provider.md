# `federation/missing-provider`

- Category: **reliability**
- Default severity: **error**

## Issue

Every consumer disabled its fallback, so no build can provide the package.

## How to fix it

Let at least one build provide the package or restore a local fallback.

Suppress or retarget with `rules["federation/missing-provider"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
