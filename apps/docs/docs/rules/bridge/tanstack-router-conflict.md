# `bridge/tanstack-router-conflict`

- Category: **tooling**
- Default severity: **info**

## Issue

Bridge router aliasing plus `@tanstack/react-router` can duplicate navigation ownership in one app.

## How to fix it

Disable Bridge router or isolate TanStack Router, or set `rules["bridge/tanstack-router-conflict"]` to `"off"`.

Suppress or retarget with `rules["bridge/tanstack-router-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
