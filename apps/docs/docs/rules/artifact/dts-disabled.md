# `artifact/dts-disabled`

- Category: **reliability**
- Default severity: **warning**

## Issue

Consumers receive no automatic contract for exposed TypeScript modules.

## How to fix it

Enable DTS generation or document and test another declaration delivery path.

Suppress or retarget with `rules["artifact/dts-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
