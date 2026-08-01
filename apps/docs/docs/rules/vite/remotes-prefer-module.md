# `vite/remotes-prefer-module`

- Category: **correctness**
- Default severity: **warning**

## Issue

Vite string remotes and missing `type` default to `var`. Vite↔Vite ESM remotes need explicit `type: 'module'` or a `varFilename` interop story.

## How to fix it

Declare object remotes with `type: 'module'` for Vite hosts, or set `varFilename` when intentionally loading webpack/rspack `var` remotes.

Suppress or retarget with `rules["vite/remotes-prefer-module"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://module-federation.io/configure/remotes.html)
