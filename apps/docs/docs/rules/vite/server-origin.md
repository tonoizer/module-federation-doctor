# `vite/server-origin`

- Category: **reliability**
- Default severity: **warning**

## Issue

Without `server.origin`, remote consumers may resolve assets against the wrong public origin in development.

## How to fix it

Set Vite `server.origin` to the URL remotes should publish for consumers.

Suppress or retarget with `rules["vite/server-origin"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
