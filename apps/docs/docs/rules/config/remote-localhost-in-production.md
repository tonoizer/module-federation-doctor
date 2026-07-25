# `config/remote-localhost-in-production`

- Category: **reliability**
- Default severity: **warning**

## Issue

Localhost remotes in CI/production builds cannot resolve on other machines and break deployments.

## How to fix it

Point remotes at deployed HTTPS (or manifest) URLs for CI and production builds.

Override this rule with `rules["config/remote-localhost-in-production"]`.

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
