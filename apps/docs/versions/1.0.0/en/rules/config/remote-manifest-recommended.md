# `config/remote-manifest-recommended`

- Category: **tooling**
- Default severity: **info**

## Issue

A direct remote entry lacks manifest-powered type hints, preloading data, and richer DevTools data. The `demo` policy only softens this recommendation for explicitly known-local bare/relative entries or loopback URLs during development; external, authenticated non-loopback, unknown, and CI remotes remain visible.

## How to fix it

Point consumers at `mf-manifest.json` when those capabilities are wanted.

Suppress or retarget with `rules["config/remote-manifest-recommended"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://module-federation.io/configure/manifest.html)
