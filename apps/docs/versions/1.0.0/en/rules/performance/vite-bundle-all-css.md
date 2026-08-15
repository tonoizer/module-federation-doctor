# `performance/vite-bundle-all-css`

- Category: **performance**
- Default severity: **warning**

## Issue

Vite attaches all bundle CSS to every expose, which can duplicate transfer and style work.

## How to fix it

Disable `bundleAllCSS` unless every expose needs the complete stylesheet set.

Suppress or retarget with `rules["performance/vite-bundle-all-css"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
