# `config/share-scope-undeclared`

- Category: **correctness**
- Default severity: **error**

## Issue

A dependency placed in a scope the container does not initialize cannot be reused there.

## How to fix it

Declare the scope at top level or move the shared item into an initialized scope.

Suppress or retarget with `rules["config/share-scope-undeclared"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shareScope.html)
