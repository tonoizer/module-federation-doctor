# `artifact/public-path-suspicious`

- Category: **correctness**
- Default severity: **warning**

## Issue

A malformed asset base makes remote chunks and styles resolve from the wrong URL.

## How to fix it

Use `auto`, a root-relative path, HTTPS URL, or reviewed dynamic getter.

Suppress or retarget with `rules["artifact/public-path-suspicious"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/getpublicpath.html)
