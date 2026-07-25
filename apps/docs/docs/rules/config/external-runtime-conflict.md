# `config/external-runtime-conflict`

- Category: **correctness**
- Default severity: **error**

## Issue

The same build cannot externalize the runtime it is responsible for providing.

## How to fix it

Provide at the top consumer and externalize only its browser remotes.

Override this rule with `rules["config/external-runtime-conflict"]`.

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
