# `config/implementation-suspicious`

- Category: **reliability**
- Default severity: **info**

## Issue

A custom implementation can violate the runtime contract expected by the build plugin.

## How to fix it

Use a compatible `@module-federation/runtime-tools` path and pin compatible versions.

Suppress or retarget with `rules["config/implementation-suspicious"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/implementation.html)
