# `config/nested-producer-dts-extract`

- Category: **reliability**
- Default severity: **warning**

## Issue

A producer can omit remote types only when an exposed module actually re-exports a configured remote and the remote types are not extracted.

## How to fix it

Enable `dts.generateTypes.extractRemoteTypes` when an exposed module reaches a remote through a local import or re-export.

Suppress or retarget with `rules["config/nested-producer-dts-extract"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
