# `reliability/vite-fixed-parse-timeout`

- Category: **reliability**
- Default severity: **info**

## Issue

A busy large build can exceed a fixed timeout and produce incomplete remote/shared analysis.

## How to fix it

Prefer `moduleParseIdleTimeout` so only inactivity ends parsing.

Suppress or retarget with `rules["reliability/vite-fixed-parse-timeout"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
