# `vite/var-filename-interop`

- Category: **tooling**
- Default severity: **info**

## Issue

`varFilename` emits an additional global-format remote entry so var hosts (webpack/rspack) can load this Vite producer.

## How to fix it

Keep `varFilename` when serving webpack/rspack var hosts. Prefer `type: 'module'` remotes when this app is a Vite consumer talking to Vite producers.

Suppress or retarget with `rules["vite/var-filename-interop"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite)
