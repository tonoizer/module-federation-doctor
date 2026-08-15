# `bridge/disable-alias-deprecated`

- Category: **tooling**
- Default severity: **info**

## Issue

`bridge.disableAlias` is a deprecated escape hatch; explicit `enableBridgeRouter` communicates intent clearly.

## How to fix it

Prefer `enableBridgeRouter: false` (or true) over `disableAlias`, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/disable-alias-deprecated"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
