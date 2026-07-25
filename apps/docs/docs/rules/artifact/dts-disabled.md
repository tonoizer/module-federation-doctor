# `artifact/dts-disabled`

- Category: **reliability**
- Default severity: **warning**

## Issue

Consumers receive no automatic contract for exposed TypeScript modules.

## How to fix it

Enable DTS generation or document and test another declaration delivery path.

Override this rule with `rules["artifact/dts-disabled"]`.

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
