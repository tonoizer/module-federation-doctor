# `config/external-runtime-with-exposes`

- Category: **correctness**
- Default severity: **error**

## Issue

A runtime provider is only supported on a pure consumer and the upstream plugin throws otherwise.

## How to fix it

Move `provideExternalRuntime` to the top consumer or remove exposes.

Suppress or retarget with `rules["config/external-runtime-with-exposes"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
