# `shared/singleton-mismatch`

- Category: **reliability**
- Default severity: **warning**

## Issue

Projects disagree on whether multiple instances are allowed.

## How to fix it

Use one federation-wide singleton policy for stateful packages.

Suppress or retarget with `rules["shared/singleton-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
