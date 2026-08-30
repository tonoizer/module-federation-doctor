# `reliability/shared-import-false`

- Category: **reliability**
- Default severity: **warning**

## Issue

With `import: false`, a federation participant has no local fallback if another provider is missing. When workspace evidence shows no provider at all, `federation/missing-provider` owns that finding instead.

## How to fix it

Guarantee a provider loads first or restore a local fallback.

Suppress or retarget with `rules["reliability/shared-import-false"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
