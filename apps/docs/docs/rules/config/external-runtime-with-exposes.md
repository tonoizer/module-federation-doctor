# `config/external-runtime-with-exposes`

- Category: **correctness**
- Default severity: **error**

## Issue

A runtime provider is only supported on a pure consumer and the upstream plugin throws otherwise.

## How to fix it

Move `provideExternalRuntime` to the top consumer or remove exposes.

Override this rule with `rules["config/external-runtime-with-exposes"]`.

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
