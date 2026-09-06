# `config/js-remote-without-type-urls`

- Category: **reliability**
- Default severity: **warning**

## Issue

Hosts that consume types cannot resolve a stable type archive URL from a direct `.js` remote entry. Manifest remotes publish type metadata; otherwise `consumeTypes.remoteTypeUrls` must name the zip/api URLs.

## How to fix it

Point remotes at `mf-manifest.json`, or set `dts.consumeTypes.remoteTypeUrls` for each direct `.js` remote. Disable `dts.consumeTypes` when the host does not consume federated types.

Suppress or retarget with `rules["config/js-remote-without-type-urls"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
- [Official source](https://module-federation.io/configure/remotes.html)
