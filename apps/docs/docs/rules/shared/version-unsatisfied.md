# `shared/version-unsatisfied`

- Category: **correctness**
- Default severity: **error**

## Issue

The installed provider does not satisfy the configured consumer range.

## How to fix it

Align installed versions and `requiredVersion` across the federation.

Override this rule with `rules["shared/version-unsatisfied"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
