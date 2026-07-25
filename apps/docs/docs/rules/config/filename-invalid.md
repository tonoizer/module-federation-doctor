# `config/filename-invalid`

- Category: **security**
- Default severity: **error**

## Issue

Unsafe paths can escape output layout; a non-JavaScript entry cannot run as a container.

## How to fix it

Use a relative `.js` or `.mjs` filename without absolute or `..` segments.

Override this rule with `rules["config/filename-invalid"]`.

## Sources

- [Official source](https://module-federation.io/configure/filename.html)
