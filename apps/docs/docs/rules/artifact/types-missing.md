# `artifact/types-missing`

- Category: **tooling**
- Default severity: **warning**

## Issue

No emitted declaration artifact was found for a typed producer.

## How to fix it

Enable DTS output and fail CI when type generation fails.

Override this rule with `rules["artifact/types-missing"]`.

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
