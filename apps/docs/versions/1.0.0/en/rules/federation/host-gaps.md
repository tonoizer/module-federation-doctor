# `federation/host-gaps`

- Category: **performance**
- Default severity: **warning**

## Issue

A package used by two or more federation projects is missing from every `shared` config, so each app may bundle its own copy.

## How to fix it

Add the package to `shared` (usually as a singleton) in every participating project that imports it.

Suppress or retarget with `rules["federation/host-gaps"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
