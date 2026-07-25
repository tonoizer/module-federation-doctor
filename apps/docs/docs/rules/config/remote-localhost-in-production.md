# `config/remote-localhost-in-production`

- Category: **reliability**
- Default severity: **warning**

## Issue

Localhost remotes in CI/production builds cannot resolve on other machines and break deployments.

## How to fix it

Point remotes at deployed HTTPS (or manifest) URLs for CI and production builds.

Suppress or retarget with `rules["config/remote-localhost-in-production"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
