# `runtime/shared-mismatch`

- Category: **reliability**
- Default severity: **error**

## Issue

Runtime shared selection conflicts with installed versions, required ranges, or provider config.

## How to fix it

Align shared versions, singleton/import settings, and providers across hosts and remotes.

Suppress or retarget with `rules["runtime/shared-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
- [Official source](https://module-federation.io/configure/shared.html)
