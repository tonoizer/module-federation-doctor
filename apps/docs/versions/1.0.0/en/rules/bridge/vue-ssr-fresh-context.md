# `bridge/vue-ssr-fresh-context`

- Category: **reliability**
- Default severity: **warning**

## Issue

Reusing one Vue app/router/store across SSR requests leaks request state between users.

## How to fix it

Create per-request app/router/store factories (or use Bridge SSR hydration helpers). Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["bridge/vue-ssr-fresh-context"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/integrations/practice/vue)
