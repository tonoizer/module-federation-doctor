# `security/get-public-path-dynamic-code`

- Category: **security**
- Default severity: **warning**

## Issue

Module Federation evaluates this string with `new Function` in the consumer.

## How to fix it

Keep it static, review it as code, and never concatenate untrusted data.

Suppress or retarget with `rules["security/get-public-path-dynamic-code"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/getpublicpath.html)
