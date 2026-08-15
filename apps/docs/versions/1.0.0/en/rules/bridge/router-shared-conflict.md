# `bridge/router-shared-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

Bridge router aliases React Router; sharing `react-router` / `react-router-dom` at the same time can load duplicate router runtimes and break navigation.

## How to fix it

Remove React Router from `shared`, or disable Bridge router with `bridge.enableBridgeRouter: false`. Soften with `rules["bridge/router-shared-conflict"]: "off"` when intentional.

Suppress or retarget with `rules["bridge/router-shared-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
- [Official source](https://module-federation.io/configure/shared.html)
