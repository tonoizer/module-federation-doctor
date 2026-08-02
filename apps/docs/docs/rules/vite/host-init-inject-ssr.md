# `vite/host-init-inject-ssr`

- Category: **correctness**
- Default severity: **error**

## Issue

SSR and HTML-less frameworks need host init injected into the entry, not the HTML document, or federation bootstrap never runs on the server.

## How to fix it

Set `hostInitInjectLocation: 'entry'` for SSR / Nitro / Nuxt-style apps.

Suppress or retarget with `rules["vite/host-init-inject-ssr"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
