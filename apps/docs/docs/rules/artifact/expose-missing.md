# `artifact/expose-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

The config promises an expose that the emitted manifest does not contain.

## How to fix it

Rebuild the producer so the expose lands in `mf-manifest.json`, or remove the stale `exposes` key from the Module Federation config.

Suppress or retarget with `rules["artifact/expose-missing"]` set to `"off"` or a severity, see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/exposes.html)
- [Official source](https://module-federation.io/configure/manifest.html)
