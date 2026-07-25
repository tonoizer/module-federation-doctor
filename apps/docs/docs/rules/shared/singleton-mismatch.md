# `shared/singleton-mismatch`

- Category: **reliability**
- Default severity: **warning**

## Issue

Projects disagree on whether multiple instances are allowed.

## How to fix it

Use one federation-wide singleton policy for stateful packages.

Override this rule with `rules["shared/singleton-mismatch"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
