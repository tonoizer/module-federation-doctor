# `reliability/version-first-offline-remotes`

- Category: **reliability**
- Default severity: **warning**

## Issue

An unavailable remote can break startup before its exposed module is requested.

## How to fix it

Add `errorLoadRemote` recovery or choose `loaded-first` for delayed failure.

Override this rule with `rules["reliability/version-first-offline-remotes"]`.

## Sources

- [Official source](https://module-federation.io/configure/shareStrategy.html)
- [Official source](https://module-federation.io/configure/runtimeplugins.html)
