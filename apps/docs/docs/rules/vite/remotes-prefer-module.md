# `vite/remotes-prefer-module`

- Category: **correctness**
- Default severity: **warning**

## Issue

Vite string remotes and missing/`var` type default to script-style loading. Vite↔Vite ESM remotes need explicit `type: 'module'`; mixed bundlers should declare an explicit non-default type (for example `global`) or document a `varFilename` producer interop path.

## How to fix it

Prefer object remotes with `type: 'module'` for Vite↔Vite ESM. For webpack/rspack remotes, set an explicit type such as `global`, or keep `varFilename` when this app intentionally emits a var entry for var hosts.

Suppress or retarget with `rules["vite/remotes-prefer-module"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://module-federation.io/configure/remotes.html)
