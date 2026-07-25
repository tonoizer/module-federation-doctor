# `performance/version-first-startup`

- Category: **performance**
- Default severity: **info**

## Issue

`version-first` loads all remote entries during initialization, adding startup work.

## How to fix it

Use `loaded-first` when on-demand loading is more important than highest-version selection.

Override this rule with `rules["performance/version-first-startup"]`.

## Sources

- [Official source](https://module-federation.io/configure/shareStrategy.html)
