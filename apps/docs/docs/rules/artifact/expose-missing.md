# `artifact/expose-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

The config promises an expose that the emitted manifest does not contain.

## How to fix it

Fix the expose build or remove the stale public contract.

Suppress or retarget with `rules["artifact/expose-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/exposes.html)
- [Official source](https://module-federation.io/configure/manifest.html)
