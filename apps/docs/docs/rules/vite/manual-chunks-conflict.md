# `vite/manual-chunks-conflict`

- Category: **reliability**
- Default severity: **warning**

## Issue

Custom manualChunks / codeSplitting.groups can fight federation bootstrap chunk ownership and create init-order cycles.

## How to fix it

Keep federation runtime chunks isolated; move general splitting outside that graph or allowlist a proven layout.

Suppress or retarget with `rules["vite/manual-chunks-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
