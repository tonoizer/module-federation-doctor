# `config/get-public-path-invalid`

- Category: **correctness**
- Default severity: **error**

## Issue

The runtime cannot evaluate an invalid stringified public-path function.

## How to fix it

Use a stringified function, arrow function, or return statement.

Override this rule with `rules["config/get-public-path-invalid"]`.

## Sources

- [Official source](https://module-federation.io/configure/getpublicpath.html)
