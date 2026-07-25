# `config/get-public-path-invalid`

- Category: **correctness**
- Default severity: **error**

## Issue

The runtime cannot evaluate an invalid stringified public-path function.

## How to fix it

Use a stringified function, arrow function, or return statement.

Suppress or retarget with `rules["config/get-public-path-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/getpublicpath.html)
