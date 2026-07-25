# `shared/unused`

- Category: **performance**
- Default severity: **warning**

## Issue

Unused shared declarations add runtime bookkeeping and can signal stale config.

## How to fix it

Remove stale entries, or ensure usage is visible via static imports, string-literal `import()` / `loadShare`, or an opt-in Observability runtime trace.

Suppress or retarget with `rules["shared/unused"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
