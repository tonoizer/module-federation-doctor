# `runtime-plugins/create-script-cors-parity`

- Category: **reliability**
- Default severity: **warning**

## Issue

CORS on createScript without matching createLink makes preload and load use different cache keys.

## How to fix it

Mirror crossorigin (and credentials where applicable) on createLink; keep fetch credentials consistent.

Suppress or retarget with `rules["runtime-plugins/create-script-cors-parity"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/troubleshooting/runtime.html)
- [Official source](https://module-federation.io/guide/runtime/runtime-hooks.html)
