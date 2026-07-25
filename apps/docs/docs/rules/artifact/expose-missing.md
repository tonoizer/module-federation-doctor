# `artifact/expose-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

The config promises an expose that the emitted manifest does not contain.

## How to fix it

Fix the expose build or remove the stale public contract.

Override this rule with `rules["artifact/expose-missing"]`.

## Sources

- [Official source](https://module-federation.io/configure/exposes.html)
- [Official source](https://module-federation.io/configure/manifest.html)
