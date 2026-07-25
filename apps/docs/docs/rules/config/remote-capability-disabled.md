# `config/remote-capability-disabled`

- Category: **correctness**
- Default severity: **error**

## Issue

Tree-shaken remote-consumption code cannot load configured remotes.

## How to fix it

Remove `disableRemote` or remove all consumed remotes.

Override this rule with `rules["config/remote-capability-disabled"]`.

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://github.com/module-federation/core)
