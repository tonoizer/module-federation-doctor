# `shared/unused`

- Category: **performance**
- Default severity: **warning**

## Issue

Unused shared declarations add runtime bookkeeping and can signal stale config.

## How to fix it

Remove stale entries, or ensure usage is visible via static imports, string-literal `import()` / `loadShare`, or an opt-in Observability runtime trace.

Override this rule with `rules["shared/unused"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
