# `config/remote-type-urls-missing`

- Category: **tooling**
- Default severity: **warning**

## Issue

Doctor reports this only when it can prove that a direct remote entry's inferred type location cannot match known producer output. Normal `remoteEntry.js` entries infer `@mf-types.zip` by default.

## How to fix it

Keep the default inferred type location when producer output follows Module Federation defaults. Use `dts.consumeTypes.remoteTypeUrls` only for runtime-only or custom type locations.

Suppress or retarget with `rules["config/remote-type-urls-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
- [Official source](https://module-federation.io/configure/remotes.html)
