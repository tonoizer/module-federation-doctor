# `reliability/async-startup-library-promise`

- Category: **reliability**
- Default severity: **warning**

## Issue

Async startup changes synchronous library entry exports into a Promise contract.

## How to fix it

Make consumers await it or keep synchronous startup for that library.

Suppress or retarget with `rules["reliability/async-startup-library-promise"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
