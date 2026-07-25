# `config/name-required`

- Category: **correctness**
- Default severity: **error**

## Issue

The runtime uses the container name for global state and module lookup.

## How to fix it

Set a stable, non-empty, federation-wide unique name.

Override this rule with `rules["config/name-required"]`.

## Sources

- [Official source](https://module-federation.io/configure/name.html)
