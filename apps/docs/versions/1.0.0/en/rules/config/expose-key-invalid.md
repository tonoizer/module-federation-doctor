# `config/expose-key-invalid`

- Category: **correctness**
- Default severity: **error**

## Issue

Consumers cannot address an expose whose public key does not follow the `./Name` form.

## How to fix it

Rename the key to start with `./` and update consumer imports.

Suppress or retarget with `rules["config/expose-key-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/exposes.html)
