# `config/get-public-path-unused`

- Category: **tooling**
- Default severity: **info**

## Issue

`getPublicPath` has no effect on a consumer that exposes no modules.

## How to fix it

Remove dead config or move it to the producer that owns the assets.

Override this rule with `rules["config/get-public-path-unused"]`.

## Sources

- [Official source](https://module-federation.io/configure/getpublicpath.html)
