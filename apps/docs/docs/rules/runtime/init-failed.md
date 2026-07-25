# `runtime/init-failed`

- Category: **reliability**
- Default severity: **error**

## Issue

Container initialization failed before exposes or shared resolution could finish.

## How to fix it

Verify async startup, external runtime provider order, and runtime plugins against Doctor project facts.

Suppress or retarget with `rules["runtime/init-failed"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
- [Official source](https://module-federation.io/configure/experiments.html)
