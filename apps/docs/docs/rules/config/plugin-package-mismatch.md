# `config/plugin-package-mismatch`

- Category: **correctness**
- Default severity: **warning**

## Issue

Using the wrong integration can skip required bundler hooks and runtime generation.

## How to fix it

Use the official package for Vite, Rspack, Rsbuild, or Webpack.

Suppress or retarget with `rules["config/plugin-package-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/integrations/index.html)
