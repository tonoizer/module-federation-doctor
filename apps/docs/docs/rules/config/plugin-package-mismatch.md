# `config/plugin-package-mismatch`

- Category: **correctness**
- Default severity: **warning**

## Issue

Using the wrong integration can skip required bundler hooks and runtime generation. On Rspack, leftover `@module-federation/rspack` (alone or mixed with `@module-federation/enhanced`) misses Enhanced options such as asyncStartup.

## How to fix it

Use the official package for Vite, Rspack, Rsbuild, Webpack, or Modern.js. For Rspack, depend on `@module-federation/enhanced` (or `@module-federation/enhanced/rspack`) and remove leftover `@module-federation/rspack`.

Suppress or retarget with `rules["config/plugin-package-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/integrations/index.html)
- [Official source](https://module-federation.io/integrations/build-tool/rspack)
