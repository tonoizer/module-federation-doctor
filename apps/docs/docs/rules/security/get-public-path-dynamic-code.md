# `security/get-public-path-dynamic-code`

- Category: **security**
- Default severity: **warning**

## Issue

Module Federation evaluates this string with `new Function` in the consumer.

## How to fix it

Keep it static, review it as code, and never concatenate untrusted data.

Override this rule with `rules["security/get-public-path-dynamic-code"]`.

## Sources

- [Official source](https://module-federation.io/configure/getpublicpath.html)
