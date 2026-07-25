# `config/implementation-suspicious`

- Category: **reliability**
- Default severity: **warning**

## Issue

A custom implementation can violate the runtime contract expected by the build plugin.

## How to fix it

Use a compatible `@module-federation/runtime-tools` path and pin compatible versions.

Override this rule with `rules["config/implementation-suspicious"]`.

## Sources

- [Official source](https://module-federation.io/configure/implementation.html)
