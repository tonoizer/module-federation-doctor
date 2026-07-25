# `runtime/shared-mismatch`

- Category: **reliability**
- Default severity: **error**

## Issue

Runtime shared selection conflicts with installed versions, required ranges, or provider config.

## How to fix it

Align shared versions, singleton/import settings, and providers across hosts and remotes.

Override this rule with `rules["runtime/shared-mismatch"]`.

## Sources

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
- [Official source](https://module-federation.io/configure/shared.html)
