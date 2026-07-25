# `shared/deep-import-bypass`

- Category: **performance**
- Default severity: **warning**

## Issue

Subpath imports bypass Module Federation shared-scope negotiation when only the root package is declared in `shared`, so each microfrontend may bundle its own copy.

## How to fix it

Prefer root imports (for example `import { cloneDeep } from "lodash"`), or add the exact subpath keys to `shared`. Suppress intentional cases with `rules["shared/deep-import-bypass"]` or `deepImportAllowlist`.

Override this rule with `rules["shared/deep-import-bypass"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
