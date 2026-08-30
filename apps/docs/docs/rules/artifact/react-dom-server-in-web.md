# `artifact/react-dom-server-in-web`

- Category: **correctness**
- Default severity: **error**

## Issue

react-dom/server (and related server entries) in a web/client Module Federation bundle crash or mis-target the browser runtime — a common MF/SSR boundary failure.

## How to fix it

Keep `react-dom/server` (and `react-dom/server.*`) on the SSR/server build only. Use a client entry such as `react-dom/client` for web remotes/hosts, or mark the target with `ssrMode: "node"` / `experiments.target: "node"` when the artifact is server-only. Set `rules["artifact/react-dom-server-in-web"]` to `"off"` when intentional.

Suppress or retarget with `rules["artifact/react-dom-server-in-web"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://react.dev/reference/react-dom/server)
- [Official source](https://module-federation.io/guide/framework/react)
