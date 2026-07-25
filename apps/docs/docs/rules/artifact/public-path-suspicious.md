# `artifact/public-path-suspicious`

- Category: **correctness**
- Default severity: **warning**

## Issue

A malformed asset base makes remote chunks and styles resolve from the wrong URL.

## How to fix it

Use `auto`, a root-relative path, HTTPS URL, or reviewed dynamic getter.

Override this rule with `rules["artifact/public-path-suspicious"]`.

## Sources

- [Official source](https://module-federation.io/configure/getpublicpath.html)
