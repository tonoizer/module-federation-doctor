# `artifact/dts-disabled`

- Category: **reliability**
- Default severity: **warning**

## Issue

When a producer exposes modules but explicitly disables DTS, consumers receive
no automatic checked declaration contract for those modules.

## How to fix it

Set `dts: true` (or enable `dts.generateTypes`). If another declaration delivery
path is intentional, document and test it, then turn this rule off for that
project.

Suppress or retarget with `rules["artifact/dts-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
