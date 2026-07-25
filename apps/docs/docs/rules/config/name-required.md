# `config/name-required`

- Category: **correctness**
- Default severity: **error**

## Issue

The runtime uses the container name for global state and module lookup. Official plugins also reject a missing name at startup, so Doctor keeps this for offline checks rather than a showcase fixture.

## How to fix it

Set `name` to a stable, federation-wide unique id such as "host" or "shop".

Override this rule with `rules["config/name-required"]`.

## Sources

- [Official source](https://module-federation.io/configure/name.html)
