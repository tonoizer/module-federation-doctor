# `federation/version-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

No installed provider version satisfies every consumer range.

## How to fix it

Align lockfiles and compatible `requiredVersion` ranges.

Override this rule with `rules["federation/version-conflict"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
