# `bridge/vue-server-entry`

- Category: **reliability**
- Default severity: **warning**

## Issue

Browser-only Vue Bridge entries in node/SSR builds miss the server/hydration contract and can leak client-only Bridge code.

## How to fix it

Import `@module-federation/bridge-vue3/server` (or the documented SSR entry). Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["bridge/vue-server-entry"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/integrations/practice/vue)
