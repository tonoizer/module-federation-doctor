# `shared/react-host-missing`

- Category: **correctness**
- Default severity: **warning**

## Issue

A React host that loads remotes without sharing its imported React runtime can create separate React or renderer instances across the federation graph.

## How to fix it

Declare imported `react` and `react-dom` packages as singleton shared dependencies, for example `{ singleton: true }`, or suppress the rule when the separate runtime is intentional.

Suppress or retarget with `rules["shared/react-host-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
