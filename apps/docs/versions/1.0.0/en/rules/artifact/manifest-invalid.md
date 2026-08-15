# `artifact/manifest-invalid`

- Category: **correctness**
- Default severity: **error**

## Issue

The runtime and tooling cannot consume malformed or incomplete manifest JSON.

## How to fix it

Rebuild the manifest and verify `metaData`, `exposes`, and `shared` are present.

Suppress or retarget with `rules["artifact/manifest-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://github.com/module-federation/core)
