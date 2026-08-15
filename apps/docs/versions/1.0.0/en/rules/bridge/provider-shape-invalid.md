# `bridge/provider-shape-invalid`

- Category: **correctness**
- Default severity: **error**

## Issue

Incomplete `createRemoteAppComponent` / `createBridgeComponent` options omit required loader/module or root component contracts and break Bridge remotes.

## How to fix it

Pass a complete options object (loader/module for consumers, or a root component for export-app). Fallback/loading UX is covered by `bridge/missing-fallback-loading`. Turn the rule `"off"` when source facts are too thin or the call shape is dynamic.

Suppress or retarget with `rules["bridge/provider-shape-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
