# `config/eager-tree-shaking-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

Eager modules live in the initial entry and cannot use the on-demand shared tree-shaking path.

## How to fix it

Choose eager loading for small dependencies or tree shaking for larger libraries.

Override this rule with `rules["config/eager-tree-shaking-conflict"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://github.com/module-federation/vite)
