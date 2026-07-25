# `artifact/manifest-expose-assets-empty`

- Category: **reliability**
- Default severity: **warning**

## Issue

Preload and debugging tools cannot map an expose to its assets.

## How to fix it

Ensure the expose is built and manifest asset analysis completes.

Suppress or retarget with `rules["artifact/manifest-expose-assets-empty"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
