# `vite/remote-hmr-dev`

- Category: **tooling**
- Default severity: **info**

## Issue

Without `remoteHmr`, local Vite remotes miss cross-container hot updates.

## How to fix it

Enable `remoteHmr` in development profiles when remotes/exposes are active.

Suppress or retarget with `rules["vite/remote-hmr-dev"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
