# `bridge/consumer-api-manual`

- Category: **reliability**
- Default severity: **warning**

## Issue

Hand-rolled `loadRemote` / remote mounts skip Bridge lifecycle helpers and lose documented loading/error contracts.

## How to fix it

Prefer `createRemoteAppComponent` / `createBridge` from `@module-federation/bridge-react`, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/consumer-api-manual"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
