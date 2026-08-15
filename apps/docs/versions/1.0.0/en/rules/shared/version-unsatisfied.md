# `shared/version-unsatisfied`

- Category: **correctness**
- Default severity: **error**

## Issue

The installed provider does not satisfy the configured consumer range.

## How to fix it

Align installed versions and `requiredVersion` across the federation.

Suppress or retarget with `rules["shared/version-unsatisfied"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
