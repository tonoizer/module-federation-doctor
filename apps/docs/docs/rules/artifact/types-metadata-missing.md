# `artifact/types-metadata-missing`

- Category: **tooling**
- Default severity: **warning**

## Issue

The manifest cannot advertise generated type archives to consumers.

## How to fix it

Fix DTS generation and ensure its metadata reaches the manifest.

Suppress or retarget with `rules["artifact/types-metadata-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://module-federation.io/configure/dts.html)
