# `config/shared-externals-conflict`

- Category: **correctness**
- Default severity: **warning**

## Issue

A library listed in both `shared` and bundler `externals` is excluded from the bundle while still declared as shared, which causes runtime failures.

## How to fix it

Remove the package from `shared` or from bundler `externals` (webpack/rspack `externals`, rsbuild `output.externals`). Functions and regex externals are not compared. When externals were not observed (CLI without `externals` and without an adapter), this rule skips.

Suppress or retarget with `rules["config/shared-externals-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://webpack.js.org/configuration/externals/)
- [Official source](https://rspack.rs/config/externals)
- [Official source](https://rsbuild.rs/config/output/externals)
