# `ssr/node-runtime-plugin-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

Without `@module-federation/node/runtimePlugin`, Node Federation hosts cannot load remotes with the server runtime contract.

## How to fix it

Add `@module-federation/node/runtimePlugin` to `runtimePlugins`. Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["ssr/node-runtime-plugin-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/plugin/plugins/)
- [Official source](https://module-federation.io/blog/node)
