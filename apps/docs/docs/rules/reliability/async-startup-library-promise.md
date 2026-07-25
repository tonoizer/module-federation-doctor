# `reliability/async-startup-library-promise`

- Category: **reliability**
- Default severity: **warning**

## Issue

Async startup changes synchronous library entry exports into a Promise contract.

## How to fix it

Make consumers await it or keep synchronous startup for that library.

Override this rule with `rules["reliability/async-startup-library-promise"]`.

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
