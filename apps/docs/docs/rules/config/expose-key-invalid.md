# `config/expose-key-invalid`

- Category: **correctness**
- Default severity: **error**

## Issue

Consumers cannot address an expose whose public key does not follow the `./Name` form.

## How to fix it

Rename the key to start with `./` and update consumer imports.

Override this rule with `rules["config/expose-key-invalid"]`.

## Sources

- [Official source](https://module-federation.io/configure/exposes.html)
