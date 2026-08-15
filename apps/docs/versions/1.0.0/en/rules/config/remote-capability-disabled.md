# `config/remote-capability-disabled`

- Category: **correctness**
- Default severity: **error**

## Issue

Tree-shaken remote-consumption code cannot load configured remotes.

## How to fix it

Remove `disableRemote` or remove all consumed remotes.

Suppress or retarget with `rules["config/remote-capability-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://github.com/module-federation/core)
