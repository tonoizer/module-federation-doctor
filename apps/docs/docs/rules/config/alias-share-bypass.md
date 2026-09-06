# `config/alias-share-bypass`

- Category: **correctness**
- Default severity: **warning**

## Issue

Webpack/Rspack/Rsbuild resolve.alias can rewrite imports around the share scope and duplicate singleton packages.

## How to fix it

Remove the overlapping alias, drop the package from shared, or allowlist intentional bypasses via `allowPackages`. Function aliases stay unknown.

Suppress or retarget with `rules["config/alias-share-bypass"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://webpack.js.org/configuration/resolve/#resolvealias)
- [Official source](https://rspack.rs/config/resolve#resolvealias)
- [Official source](https://rsbuild.rs/config/resolve/alias)
