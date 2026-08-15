# `federation/ghost-shares`

- Category: **performance**
- Default severity: **info**

## Issue

A package is declared in `shared` by only one project and is unused elsewhere in the federation graph, creating one-sided version coupling.

## How to fix it

Remove the unused shared entry, or add matching `shared` declarations where other projects actually consume the package.

Suppress or retarget with `rules["federation/ghost-shares"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
