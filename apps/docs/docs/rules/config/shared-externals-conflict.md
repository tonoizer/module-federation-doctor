# `config/shared-externals-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

A dependency cannot be provided by federation after the bundler removes it as an external.

## How to fix it

Remove the package from either `shared` or `externals`.

Override this rule with `rules["config/shared-externals-conflict"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
