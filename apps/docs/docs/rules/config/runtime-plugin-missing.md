# `config/runtime-plugin-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

A missing runtime plugin stops injected runtime behavior from loading.

## How to fix it

Correct the path/package and include local plugin files in the Doctor scan.

Suppress or retarget with `rules["config/runtime-plugin-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/runtimeplugins.html)
