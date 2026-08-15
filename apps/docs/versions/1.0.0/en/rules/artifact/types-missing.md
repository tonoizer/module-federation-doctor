# `artifact/types-missing`

- Category: **tooling**
- Default severity: **warning**

## Issue

No emitted declaration artifact was found for a typed producer.

## How to fix it

Enable DTS output and fail CI when type generation fails.

Suppress or retarget with `rules["artifact/types-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
