# `performance/asset-budget`

- Category: **performance**
- Default severity: **warning**

## Issue

Federation assets that exceed project budgets slow startup and transfer more bytes than planned. Overlapping manifest groups are merged before the comparison so one physical asset is not counted twice.

## How to fix it

Reduce the oversized entry, expose, or shared assets, or raise `rules["performance/asset-budget"]` byte limits. Review the reported asset list before changing the budget.

Suppress or retarget with `rules["performance/asset-budget"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://module-federation.io/configure/shareStrategy.html)
