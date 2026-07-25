# `artifact/manifest-shared-version-mismatch`

- Category: **reliability**
- Default severity: **warning**

## Issue

Stale version metadata can choose the wrong shared provider at runtime.

## How to fix it

Clean output, reinstall from the lockfile, and rebuild the manifest.

Override this rule with `rules["artifact/manifest-shared-version-mismatch"]`.

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://module-federation.io/configure/shared.html)
