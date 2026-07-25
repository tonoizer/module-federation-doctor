# `config/get-public-path-unused`

- Category: **tooling**
- Default severity: **info**

## Issue

`getPublicPath` has no effect on a consumer that exposes no modules.

## How to fix it

Remove dead config or move it to the producer that owns the assets.

Suppress or retarget with `rules["config/get-public-path-unused"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/getpublicpath.html)
