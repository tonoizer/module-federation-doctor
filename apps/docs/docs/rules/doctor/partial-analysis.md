# `doctor/partial-analysis`

- Category: **tooling**
- Default severity: **warning**

## Issue

Missing facts or unresolved dynamic imports reduce confidence and can hide relevant findings.

## How to fix it

Pass explicit MF options, run Doctor through the bundler adapter after emit, and prefer string-literal dynamic imports or an opt-in runtime trace when analysis is incomplete.

Override this rule with `rules["doctor/partial-analysis"]`.

## Sources

- [Official source](https://module-federation.io/configure/index.html)
