# `vite/ssr-nitro-externals`

- Category: **reliability**
- Default severity: **warning**

## Issue

Shared React (or react-dom) can conflict with Nitro/SSR externals and `ssrEntryLoader` when the server expects a different module instance.

## How to fix it

Align `shared` React with `ssrExternals` / `ssrEntryLoader` for the SSR runtime, or document an intentional dual-instance path.

Suppress or retarget with `rules["vite/ssr-nitro-externals"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
