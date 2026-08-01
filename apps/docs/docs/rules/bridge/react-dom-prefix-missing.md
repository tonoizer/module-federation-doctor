# `bridge/react-dom-prefix-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

Bridge React v18/v19 needs `react-dom/` (or `react-dom/client`) in `shared` so renderer subpaths negotiate one copy across host and remote.

## How to fix it

Add `'react-dom/': { singleton: true, ... }` (or `react-dom/client`) to `shared`. Disable with `requireReactDomPrefix: false` or `rules["bridge/react-dom-prefix-missing"]: "off"` when intentional.

Suppress or retarget with `rules["bridge/react-dom-prefix-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
- [Official source](https://module-federation.io/configure/shared.html)
