# `config/duplicate-plugin-registration`

- Category: **correctness**
- Default severity: **error**

## Issue

Registering Module Federation more than once on the same compiler breaks the core singleton contract.

## How to fix it

Keep a single Module Federation plugin instance per compiler.

Override this rule with `rules["config/duplicate-plugin-registration"]`.

## Sources

- [Official source](https://github.com/module-federation/core)
- [Official source](https://module-federation.io/guide/installation.html)
