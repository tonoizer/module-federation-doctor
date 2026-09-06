# `vite/virtual-module-dir`

- Category: **correctness**
- Default severity: **warning**

## Issue

A `virtualModuleDir` with slashes is not a single virtual folder. Nested names collide with virtual module IDs and break Vite federation bootstrap.

## How to fix it

Use one simple directory name without slashes, for example `__mf__`.

Suppress or retarget with `rules["vite/virtual-module-dir"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
