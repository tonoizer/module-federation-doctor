# `shared/eager-without-singleton`

- Category: **performance**
- Default severity: **warning**

## Issue

An eager non-singleton can add copies to initial chunks without guaranteeing reuse.

## How to fix it

Make it singleton when safe, or remove eager loading.

Override this rule with `rules["shared/eager-without-singleton"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
