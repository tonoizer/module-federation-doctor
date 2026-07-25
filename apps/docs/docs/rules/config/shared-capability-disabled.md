# `config/shared-capability-disabled`

- Category: **correctness**
- Default severity: **error**

## Issue

Tree-shaken sharing code cannot register or consume configured shared packages.

## How to fix it

Remove `disableShared` or remove the shared configuration.

Override this rule with `rules["config/shared-capability-disabled"]`.

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://github.com/module-federation/core)
