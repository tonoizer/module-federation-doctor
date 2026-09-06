# `vite/ignore-origin`

- Category: **reliability**
- Default severity: **info**

## Issue

`ignoreOrigin` changes proxy entry origin behavior. Without a tested Vite `server.origin`, remote URLs can resolve against the wrong host.

## How to fix it

Set Vite `server.origin` to the public deployment base you tested, or turn `ignoreOrigin` off. CLI/config-only analysis without a plugin origin fact stays unknown rather than claiming a pass.

Suppress or retarget with `rules["vite/ignore-origin"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
