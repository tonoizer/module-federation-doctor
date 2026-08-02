# `ssr/node-remote-manifest`

- Category: **correctness**
- Default severity: **error**

## Issue

Node/SSR consumers that load the browser `mf-manifest.json` miss the server remote graph and can fail to resolve remotes during SSR.

## How to fix it

Point node/SSR remotes at `/ssr/mf-manifest.json` (or another env-specific path). Set `ssrMode: "browser-only"` when the build is not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["ssr/node-remote-manifest"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/basic/manifest-snapshot.html)
- [Official source](https://module-federation.io/integrations/build-tool/rsbuild)
