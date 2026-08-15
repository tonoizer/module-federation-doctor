# `runtime-plugins/create-script-without-link`

- Category: **reliability**
- Default severity: **info**

## Issue

A createScript hook without createLink can waste preload work when link-based loading is used.

## How to fix it

Add createLink when preloadRemote or CSS/JS link loading is in play, or suppress if preload is unused.

Suppress or retarget with `rules["runtime-plugins/create-script-without-link"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/troubleshooting/runtime.html)
- [Official source](https://module-federation.io/guide/runtime/runtime-hooks.html)
