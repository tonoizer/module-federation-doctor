# `ssr/node-library-dts`

- Category: **reliability**
- Default severity: **warning**

## Issue

Node/SSR producers that keep ESM-style `library.type` or enabled `dts` diverge from the commonjs dual-env contract used by server remotes.

## How to fix it

Set `library: { type: "commonjs-module" }` (or another commonjs-like type) and `dts: false` on node/SSR producers. Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["ssr/node-library-dts"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/blog/node)
