# `config/plugin-package-mismatch`

- Category: **correctness**
- Default severity: **warning**

## Issue

Using the wrong integration can skip required bundler hooks and runtime generation.

## How to fix it

Use the official package for Vite, Rspack, or Rsbuild.

Override this rule with `rules["config/plugin-package-mismatch"]`.

## Sources

- [Official source](https://module-federation.io/integrations/index.html)
