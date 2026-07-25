# `artifact/manifest-name-mismatch`

- Category: **correctness**
- Default severity: **error**

## Issue

Stale output can register a different container than the current config.

## How to fix it

Clean output and make the federation plugin and Doctor share one options object.

Suppress or retarget with `rules["artifact/manifest-name-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
