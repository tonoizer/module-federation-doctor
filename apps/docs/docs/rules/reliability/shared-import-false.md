# `reliability/shared-import-false`

- Category: **reliability**
- Default severity: **warning**

## Issue

With `import: false`, no local fallback exists if another provider is missing.

## How to fix it

Guarantee a provider loads first or restore a local fallback.

Suppress or retarget with `rules["reliability/shared-import-false"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
