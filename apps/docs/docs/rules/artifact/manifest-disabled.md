# `artifact/manifest-disabled`

- Category: **tooling**
- Default severity: **info**

## Issue

Without manifests, consumers lose metadata-powered preloading, type hints, and richer inspection.

## How to fix it

Enable `manifest` where those production and debugging features are needed.

Override this rule with `rules["artifact/manifest-disabled"]`.

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
