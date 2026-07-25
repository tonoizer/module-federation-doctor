# `config/filename-invalid`

- Category: **security**
- Default severity: **error**

## Issue

Unsafe paths can escape output layout; a non-JavaScript entry cannot run as a container.

## How to fix it

Use a relative `.js` or `.mjs` filename without absolute or `..` segments.

Suppress or retarget with `rules["config/filename-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/filename.html)
