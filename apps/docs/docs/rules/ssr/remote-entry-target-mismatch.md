# `ssr/remote-entry-target-mismatch`

- Category: **correctness**
- Default severity: **error**

## Issue

A browser host that loads `remoteEntry.ssr.js` (or an SSR-specific path) executes the server container in the client. The reverse — an SSR host loading a browser `remoteEntry.js` — misses the server runtime contract. Dual-env Nitro pairing of client+server outputs is not this check.

## How to fix it

Point browser remotes at `remoteEntry.js` (or the client `mf-manifest.json`) and node/SSR remotes at `remoteEntry.ssr.js` or `/ssr/...`. Requires `experiments.target` / `vite.target` / unambiguous `builds.targetKind` on the consumer; missing targetKind skips. Set `ssrMode: "browser-only"` or `"node"` to force a side, or turn the rule `"off"`.

Suppress or retarget with `rules["ssr/remote-entry-target-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/basic/manifest-snapshot.html)
- [Official source](https://module-federation.io/blog/node)
