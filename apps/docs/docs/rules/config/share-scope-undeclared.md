# `config/share-scope-undeclared`

- Category: **correctness**
- Default severity: **error**

## Issue

A dependency placed in a scope the container does not initialize cannot be reused there.

## How to fix it

Declare the scope at top level or move the shared item into an initialized scope.

Override this rule with `rules["config/share-scope-undeclared"]`.

## Sources

- [Official source](https://module-federation.io/configure/shareScope.html)
