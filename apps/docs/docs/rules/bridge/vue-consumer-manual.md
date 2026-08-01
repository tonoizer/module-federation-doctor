# `bridge/vue-consumer-manual`

- Category: **reliability**
- Default severity: **warning**

## Issue

Hand-rolled `loadRemote` mounts skip Vue Bridge lifecycle helpers and documented loading/error contracts.

## How to fix it

Prefer `createRemoteAppComponent` from `@module-federation/bridge-vue3`, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/vue-consumer-manual"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/integrations/practice/vue)
