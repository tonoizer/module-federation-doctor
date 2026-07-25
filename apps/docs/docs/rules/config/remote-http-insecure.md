# `config/remote-http-insecure`

- Category: **security**
- Default severity: **warning**

## Issue

Remote code fetched over plain HTTP can be changed in transit.

## How to fix it

Serve non-local remotes over HTTPS and keep HTTP only for local development.

Override this rule with `rules["config/remote-http-insecure"]`.

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
