# `federation/external-runtime-provider-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

External-runtime remotes cannot start without a federation-wide provider.

## How to fix it

Enable `provideExternalRuntime` on one top-level pure consumer.

Override this rule with `rules["federation/external-runtime-provider-missing"]`.

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
