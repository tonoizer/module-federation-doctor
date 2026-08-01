# `runtime-plugins/invalid-factory`

- Category: **correctness**
- Default severity: **warning**

## Issue

A runtime plugin without a factory or usable `name` is ignored at runtime (silent no-op).

## How to fix it

Export a factory or plugin object that includes a stable `name` plus the hooks you intend to run.

Suppress or retarget with `rules["runtime-plugins/invalid-factory"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/runtimeplugins.html)
- [Official source](https://module-federation.io/guide/runtime/runtime-plugins.html)
