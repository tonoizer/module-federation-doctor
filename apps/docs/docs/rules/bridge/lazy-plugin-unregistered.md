# `bridge/lazy-plugin-unregistered`

- Category: **correctness**
- Default severity: **error**

## Issue

Lazy Bridge React loading requires `@module-federation/bridge-react/plugin` in `runtimePlugins` or Bridge remotes fail at runtime.

## How to fix it

Add `@module-federation/bridge-react/plugin` to `runtimePlugins`. Soften with `requireRuntimePlugin: false` or turn the rule `"off"` for non-lazy Bridge setups.

Suppress or retarget with `rules["bridge/lazy-plugin-unregistered"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
- [Official source](https://module-federation.io/configure/runtimeplugins.html)
