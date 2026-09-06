# `config/transform-import-share-conflict`

- Category: **correctness**
- Default severity: **warning**

## Issue

transformImport (or equivalent) can rewrite packages that are also shared, bypassing or duplicating the share scope.

## How to fix it

Remove the rewrite, exclude the package from shared, or allowlist intentional bypasses via `allowPackages`. Modern.js and Rsbuild adapters collect public `source.transformImport` library names. Function-form transformImport is not invoked and stays unknown, so this rule skips.

Suppress or retarget with `rules["config/transform-import-share-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://modernjs.dev/configure/app/source/transform-import)
- [Official source](https://rsbuild.rs/config/source/transform-import)
