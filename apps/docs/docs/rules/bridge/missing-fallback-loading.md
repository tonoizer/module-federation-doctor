# `bridge/missing-fallback-loading`

- Category: **reliability**
- Default severity: **warning**

## Issue

Bridge remotes without `fallback`/`loading` leave consumers with a blank screen while the remote loads or fails.

## How to fix it

Pass `fallback` and `loading` to `createRemoteAppComponent`, or set `rules["bridge/missing-fallback-loading"]` to `"off"`.

Suppress or retarget with `rules["bridge/missing-fallback-loading"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
