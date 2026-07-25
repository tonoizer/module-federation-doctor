# `artifact/remote-entry-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

A producer has no executable container at its configured filename.

## How to fix it

Check output naming and plugin order, then clean and rebuild.

Override this rule with `rules["artifact/remote-entry-missing"]`.

## Sources

- [Official source](https://module-federation.io/configure/filename.html)
