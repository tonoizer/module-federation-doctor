# `performance/asset-budget`

- Category: **performance**
- Default severity: **warning**

## Issue

Federation assets that exceed project budgets slow startup and transfer more bytes than planned.

## How to fix it

Reduce the oversized entry, expose, or shared assets, or raise `rules["performance/asset-budget"]` byte limits.

Suppress or retarget with `rules["performance/asset-budget"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://module-federation.io/configure/shareStrategy.html)
