# `bridge/export-app-missing`

- Category: **reliability**
- Default severity: **warning**

## Issue

Bridge producers without `./export-app` break the conventional Bridge remote contract expected by hosts.

## How to fix it

Expose `"./export-app"` via `createBridgeComponent` (render/destroy), or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/export-app-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
