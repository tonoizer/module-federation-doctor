# `config/expose-path-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

The producer build cannot include a module that does not exist at the configured path.

## How to fix it

Correct the path, including its exact extension, or create the source file.

Override this rule with `rules["config/expose-path-missing"]`.

## Sources

- [Official source](https://module-federation.io/configure/exposes.html)
