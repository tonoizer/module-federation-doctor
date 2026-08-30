# `federation/missing-provider`

- Category: **reliability**
- Default severity: **error**

## Issue

Workspace evidence shows consumers disabled their fallback and no build provides the package. A lone `import: false` without sibling absence proof is `reliability/shared-import-false` instead.

## How to fix it

Let at least one build provide the package or restore a local fallback.

Suppress or retarget with `rules["federation/missing-provider"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
