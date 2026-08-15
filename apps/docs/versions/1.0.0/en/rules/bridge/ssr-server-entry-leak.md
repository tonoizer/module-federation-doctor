# `bridge/ssr-server-entry-leak`

- Category: **correctness**
- Default severity: **error**

## Issue

Browser-only Bridge React entries must not load inside node/SSR builds; doing so leaks DOM-oriented Bridge code into the server bundle.

## How to fix it

Import the Bridge `/server` entry (or a node-safe path) for SSR/node targets. Override with `ssrMode: "browser-only"` when the build is not SSR, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/ssr-server-entry-leak"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
