# `config/external-runtime-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

The same build cannot externalize the runtime it is responsible for providing.

## How to fix it

Provide at the top consumer and externalize only its browser remotes.

Suppress or retarget with `rules["config/external-runtime-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
