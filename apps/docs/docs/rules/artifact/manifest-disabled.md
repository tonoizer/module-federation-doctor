# `artifact/manifest-disabled`

- Category: **tooling**
- Default severity: **info**

## Issue

Without manifests, consumers lose metadata-powered preloading, type hints, and richer inspection.

## How to fix it

Enable `manifest` where those production and debugging features are needed.

Suppress or retarget with `rules["artifact/manifest-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
