# `federation/share-scope-mismatch`

- Category: **correctness**
- Default severity: **error**

## Issue

Projects in different scopes cannot reuse the same shared provider.

## How to fix it

Align top-level, remote, and shared-item scopes intentionally.

Suppress or retarget with `rules["federation/share-scope-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shareScope.html)
