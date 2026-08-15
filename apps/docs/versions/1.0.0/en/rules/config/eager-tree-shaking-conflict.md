# `config/eager-tree-shaking-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

Eager modules live in the initial entry and cannot use the on-demand shared tree-shaking path.

## How to fix it

Choose eager loading for small dependencies or tree shaking for larger libraries.

Suppress or retarget with `rules["config/eager-tree-shaking-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://github.com/module-federation/vite)
