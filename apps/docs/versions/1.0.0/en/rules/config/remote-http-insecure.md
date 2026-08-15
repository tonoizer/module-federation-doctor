# `config/remote-http-insecure`

- Category: **security**
- Default severity: **warning**

## Issue

Remote code fetched over plain HTTP can be changed in transit.

## How to fix it

Serve non-local remotes over HTTPS and keep HTTP only for local development.

Suppress or retarget with `rules["config/remote-http-insecure"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
