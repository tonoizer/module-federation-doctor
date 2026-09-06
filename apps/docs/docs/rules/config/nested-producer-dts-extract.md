# `config/nested-producer-dts-extract`

- Category: **reliability**
- Default severity: **warning**

## Issue

A remote that both exposes modules and consumes remotes publishes an incomplete type archive unless `dts.generateTypes.extractRemoteTypes` is enabled, so nested consumers miss types from inner remotes.

## How to fix it

Enable `dts.generateTypes.extractRemoteTypes` on nested producers. Host-only consumers do not need this flag.

Suppress or retarget with `rules["config/nested-producer-dts-extract"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
