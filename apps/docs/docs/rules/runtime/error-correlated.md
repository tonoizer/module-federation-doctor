# `runtime/error-correlated`

- Category: **reliability**
- Default severity: **error**

## Issue

A stable RUNTIME error code from an imported browser trace was matched to offline build evidence.

## How to fix it

Use the RUNTIME code with the matched build facts; do not infer browser behavior from static analysis alone.

Suppress or retarget with `rules["runtime/error-correlated"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
