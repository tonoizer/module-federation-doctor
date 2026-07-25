# `shared/candidate`

- Category: **performance**
- Default severity: **info**

## Issue

A stateful framework dependency may be bundled separately by host and remote.

## How to fix it

Evaluate sharing it as a singleton across all participating projects.

Suppress or retarget with `rules["shared/candidate"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
