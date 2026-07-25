# `shared/singleton-risk`

- Category: **reliability**
- Default severity: **warning**

## Issue

Multiple framework runtimes can split global state, contexts, hooks, or renderers.

## How to fix it

Share stateful framework runtimes as singletons and align their versions.

Override this rule with `rules["shared/singleton-risk"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
