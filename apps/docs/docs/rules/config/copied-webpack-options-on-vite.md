# `config/copied-webpack-options-on-vite`

- Category: **correctness**
- Default severity: **warning**

## Issue

Webpack ModuleFederationPlugin-only options pasted onto `@module-federation/vite` are ignored or misinterpreted, which leads to silent mis-shares or runtime crashes after a webpack-to-Vite migration.

## How to fix it

Remove the listed webpack-only keys. Prefer the Vite equivalent when one exists (`remotes.<name>.type` for `remoteType`; top-level `disableRemote` / `disableShared` / `disableSnapshot` / `target` for `experiments.optimization.*`). Keys without a Vite equivalent are not applicable and should be deleted.

Suppress or retarget with `rules["config/copied-webpack-options-on-vite"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://module-federation.io/configure/remotetype.html)
- [Official source](https://module-federation.io/configure/experiments.html)
- [Official source](https://github.com/module-federation/core)
