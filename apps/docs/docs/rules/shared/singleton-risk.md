# `shared/singleton-risk`

- Category: **reliability**
- Default severity: **warning**

## Issue

Multiple framework runtimes can split global state, contexts, hooks, or renderers.

## How to fix it

Share stateful framework runtimes as singletons and align their versions.

Suppress or retarget with `rules["shared/singleton-risk"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
