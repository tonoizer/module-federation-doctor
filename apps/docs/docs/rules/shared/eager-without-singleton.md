# `shared/eager-without-singleton`

- Category: **performance**
- Default severity: **warning**

## Issue

An eager non-singleton can add copies to initial chunks without guaranteeing reuse.

## How to fix it

Make it singleton when safe, or remove eager loading.

Suppress or retarget with `rules["shared/eager-without-singleton"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
