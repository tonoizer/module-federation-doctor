# `config/remote-entry-invalid`

- Category: **correctness**
- Default severity: **error**

## Issue

The runtime cannot resolve a remote without a usable entry or manifest address.

## How to fix it

Use a valid URL/object entry or the `name@url` form supported by the bundler.

Suppress or retarget with `rules["config/remote-entry-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
