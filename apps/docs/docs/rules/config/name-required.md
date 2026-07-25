# `config/name-required`

- Category: **correctness**
- Default severity: **error**

## Issue

The runtime uses the container name for global state and module lookup.

Official Module Federation plugins already reject a missing or empty `name` at
plugin setup (Vite, Rspack / enhanced, Rsbuild, and `ContainerManager`), so a
build typically never starts without one. Doctor still reports this for offline
static checks and for whitespace-only names that some plugins do not trim.

There is no `examples/showcase` fixture for this rule: a showcase should
demonstrate findings that survive plugin init, not duplicates of a hard fail.

## How to fix it

Set a stable, non-empty, federation-wide unique name.

Override this rule with `rules["config/name-required"]`.

## Sources

- [Official source](https://module-federation.io/configure/name.html)
