# `reliability/version-first-offline-remotes`

- Category: **reliability**
- Default severity: **warning**

## Issue

An unavailable remote can break startup before its exposed module is requested.

## How to fix it

Add `errorLoadRemote` recovery or choose `loaded-first` for delayed failure.

Suppress or retarget with `rules["reliability/version-first-offline-remotes"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shareStrategy.html)
- [Official source](https://module-federation.io/configure/runtimeplugins.html)
