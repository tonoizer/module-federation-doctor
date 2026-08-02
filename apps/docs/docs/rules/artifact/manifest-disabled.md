# `artifact/manifest-disabled`

- Category: **tooling**
- Default severity: **info**

## Issue

When a project has exposes or remotes but explicitly disables manifests, consumers
lose metadata-powered preloading, dynamic type hints, and richer inspection.

## How to fix it

For a producer, set `manifest: true` to publish the metadata. For a consumer,
point remotes at the producer's `mf-manifest.json` when those capabilities are
wanted. If direct `remoteEntry.js` URLs are intentional, document that choice
and turn this rule off.

Suppress or retarget with `rules["artifact/manifest-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
