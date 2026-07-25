# `shared/candidate`

- Category: **performance**
- Default severity: **warning**

## Issue

A stateful framework dependency may be bundled separately by host and remote.

## How to fix it

Evaluate sharing it as a singleton across all participating projects.

Override this rule with `rules["shared/candidate"]`.

## Sources

- [Official source](https://module-federation.io/configure/shared.html)
