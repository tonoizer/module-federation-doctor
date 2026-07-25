# `config/remote-type-urls-missing`

- Category: **tooling**
- Default severity: **warning**

## Issue

Direct `.js` remote entries do not advertise type archives unless `remoteTypeUrls` or a manifest is configured.

## How to fix it

Prefer `mf-manifest.json`, or set `dts.consumeTypes.remoteTypeUrls` for each `.js` remote.

Suppress or retarget with `rules["config/remote-type-urls-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
- [Official source](https://module-federation.io/configure/remotes.html)
