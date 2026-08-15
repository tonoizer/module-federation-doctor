# `shared/deep-import-bypass`

- Category: **performance**
- Default severity: **warning**

## Issue

Subpath imports bypass Module Federation shared-scope negotiation when only the root package is declared in `shared`, so each microfrontend may bundle its own copy.

## How to fix it

Prefer root imports (for example `import { cloneDeep } from "lodash"`), or add the exact subpath keys to `shared`. For React and React DOM subpaths, use `shared/prefix-share-recommended`. Suppress intentional cases with `rules["shared/deep-import-bypass"]` or `deepImportAllowlist`.

Suppress or retarget with `rules["shared/deep-import-bypass"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
