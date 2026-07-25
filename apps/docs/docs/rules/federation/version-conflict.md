# `federation/version-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

No installed provider version satisfies every consumer range.

## How to fix it

Align lockfiles and compatible `requiredVersion` ranges.

Suppress or retarget with `rules["federation/version-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
