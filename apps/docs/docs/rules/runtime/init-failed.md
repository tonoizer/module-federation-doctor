# `runtime/init-failed`

- Category: **reliability**
- Default severity: **error**

## Issue

Container initialization failed before exposes or shared resolution could finish.

## How to fix it

Verify async startup, external runtime provider order, and runtime plugins against Doctor project facts.

Override this rule with `rules["runtime/init-failed"]`.

## Sources

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
- [Official source](https://module-federation.io/configure/experiments.html)
