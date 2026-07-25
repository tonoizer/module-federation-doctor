# `artifact/manifest-invalid`

- Category: **correctness**
- Default severity: **error**

## Issue

The runtime and tooling cannot consume malformed or incomplete manifest JSON.

## How to fix it

Rebuild the manifest and verify `metaData`, `exposes`, and `shared` are present.

Override this rule with `rules["artifact/manifest-invalid"]`.

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://github.com/module-federation/core)
