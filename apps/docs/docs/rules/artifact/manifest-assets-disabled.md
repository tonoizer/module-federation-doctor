# `artifact/manifest-assets-disabled`

- Category: **reliability**
- Default severity: **warning**

## Issue

Disabled asset analysis removes shared and expose asset details from producer metadata.

## How to fix it

Enable asset analysis for production producer manifests.

Override this rule with `rules["artifact/manifest-assets-disabled"]`.

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://github.com/module-federation/vite)
