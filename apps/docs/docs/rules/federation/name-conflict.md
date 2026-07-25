# `federation/name-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

Duplicate container names collide in runtime data and global chunk storage.

## How to fix it

Give every participating container a unique stable name.

Suppress or retarget with `rules["federation/name-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/name.html)
