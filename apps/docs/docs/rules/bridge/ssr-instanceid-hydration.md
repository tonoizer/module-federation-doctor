# `bridge/ssr-instanceid-hydration`

- Category: **tooling**
- Default severity: **info**

## Issue

Without a stable `bridge.instanceId`, SSR Bridge hydration registries can collide across requests.

## How to fix it

Set `bridge.instanceId` for SSR builds, use `ssrMode: "browser-only"` when not SSR, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/ssr-instanceid-hydration"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
