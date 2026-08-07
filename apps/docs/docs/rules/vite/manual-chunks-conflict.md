# `vite/manual-chunks-conflict`

- Category: **reliability**
- Default severity: **info**

## Issue

Custom manualChunks / codeSplitting.groups can fight federation bootstrap chunk ownership and create init-order cycles. This is an advisory signal because static config cannot prove a runtime cycle for every framework.

## How to fix it

Keep federation runtime chunks isolated; move general splitting outside that graph or allowlist a proven layout. Treat the finding as informational until a production build or runtime trace confirms an ordering problem.

Suppress or retarget with `rules["vite/manual-chunks-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
