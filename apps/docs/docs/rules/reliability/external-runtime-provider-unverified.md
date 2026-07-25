# `reliability/external-runtime-provider-unverified`

- Category: **reliability**
- Default severity: **warning**

## Issue

A remote fails if `_FEDERATION_RUNTIME_CORE` is absent or initialized too late.

## How to fix it

Verify a pure top consumer provides the runtime before remote execution.

Override this rule with `rules["reliability/external-runtime-provider-unverified"]`.

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
