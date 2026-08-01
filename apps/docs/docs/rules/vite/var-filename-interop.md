# `vite/var-filename-interop`

- Category: **tooling**
- Default severity: **info**

## Issue

`varFilename` emits a synchronous global-format entry for mixed bundler interop with `var` remotes.

## How to fix it

Keep `varFilename` when consuming webpack/rspack `var` remotes; prefer `type: 'module'` remotes for Vite↔Vite ESM.

Suppress or retarget with `rules["vite/var-filename-interop"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
