# `config/shared-externals-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

A dependency cannot be provided by federation after the bundler removes it as an external.

## How to fix it

Remove the package from either `shared` or `externals`.

Suppress or retarget with `rules["config/shared-externals-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
