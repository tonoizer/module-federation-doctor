# `config/copied-vite-options-on-webpack`

- Category: **correctness**
- Default severity: **warning**

## Issue

Vite-only Module Federation options pasted onto Enhanced / webpack-family configs (`virtualModuleDir`, `hostInitInjectLocation`, `bundleAllCSS`, `remoteHmr`, `varFilename`) are ignored, so a copied Vite config silently no-ops.

## How to fix it

Remove the listed Vite-only keys from webpack, Rspack, Rsbuild, or Modern.js federation options. They are `@module-federation/vite` controls and have no Enhanced equivalent.

Suppress or retarget with `rules["config/copied-vite-options-on-webpack"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://github.com/module-federation/core)
- [Official source](https://module-federation.io/configure/index.html)
