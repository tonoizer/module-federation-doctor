# `bridge/vue-share-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

Vue Bridge remotes and hosts that omit `vue` (and `vue-router` when used) from `shared` can load duplicate Vue runtimes and break reactivity or routing.

## How to fix it

Share `vue` (and `vue-router` when imported) as singletons, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/vue-share-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/integrations/practice/vue)
