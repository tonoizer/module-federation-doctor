# `federation/name-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

Duplicate container names collide in runtime data and global chunk storage.

## How to fix it

Give every participating container a unique stable name.

Override this rule with `rules["federation/name-conflict"]`.

## Sources

- [Official source](https://module-federation.io/configure/name.html)
