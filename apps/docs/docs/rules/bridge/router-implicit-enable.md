# `bridge/router-implicit-enable`

- Category: **tooling**
- Default severity: **info**

## Issue

Rspack may auto-enable Bridge router when the Bridge package is present; leaving `bridge.enableBridgeRouter` implicit hides the routing contract from reviewers and CI.

## How to fix it

Set `bridge: { enableBridgeRouter: true }` (or `false`) explicitly. Allow demos to stay implicit with `allowImplicitBridgeRouter: true` or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/router-implicit-enable"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
