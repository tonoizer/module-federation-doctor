# `artifact/public-path-non-string-manifest`

- Category: **correctness**
- Default severity: **warning**

## Issue

Module Federation skips manifest generation when bundler `output.publicPath` is not a string.

## How to fix it

Set `output.publicPath` to a string URL, root-relative path, or `auto` when manifests are required.

Override this rule with `rules["artifact/public-path-non-string-manifest"]`.

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://github.com/module-federation/core)
