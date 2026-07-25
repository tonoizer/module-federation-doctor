# `reliability/version-first-offline-remotes`

- Category: **reliability**
- Default severity: **warning**

## Issue

An unavailable remote can break startup before its exposed module is requested.

## How to fix it

Add `@module-federation/retry-plugin`, an `errorLoadRemote` recovery plugin, or choose `loaded-first` for delayed failure.

Suppress or retarget with `rules["reliability/version-first-offline-remotes"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shareStrategy.html)
- [Official source](https://module-federation.io/configure/runtimeplugins.html)
- [Official source](https://github.com/module-federation/core/tree/main/packages/retry-plugin)
