# `vite/alias-share-bypass`

- Category: **correctness**
- Default severity: **warning**

## Issue

resolve.alias can rewrite imports around the share scope and duplicate singleton packages.

## How to fix it

Remove the overlapping alias, drop the package from shared, or allowlist intentional bypasses.

Suppress or retarget with `rules["vite/alias-share-bypass"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://module-federation.io/configure/shared.html)
