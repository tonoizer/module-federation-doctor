# `vite/hashed-remote-filename`

- Category: **reliability**
- Default severity: **warning**

## Issue

Hashed remote entry filenames invalidate consumer URLs whenever the producer rebuilds.

## How to fix it

Use a stable `filename` such as `remoteEntry.js` for the container entry.

Suppress or retarget with `rules["vite/hashed-remote-filename"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://module-federation.io/configure/filename.html)
