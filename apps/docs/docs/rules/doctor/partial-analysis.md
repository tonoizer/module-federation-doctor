# `doctor/partial-analysis`

- Category: **tooling**
- Default severity: **warning**

## Issue

Missing facts reduce confidence and can hide relevant findings.

## How to fix it

Pass explicit MF options and run Doctor through the bundler adapter after emit.

Override this rule with `rules["doctor/partial-analysis"]`.

## Sources

- [Official source](https://module-federation.io/configure/index.html)
