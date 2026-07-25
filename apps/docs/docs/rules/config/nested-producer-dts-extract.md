# `config/nested-producer-dts-extract`

- Category: **reliability**
- Default severity: **warning**

## Issue

A nested producer that both exposes and consumes remotes may omit extracted remote types from its type archive.

## How to fix it

Enable `dts.generateTypes.extractRemoteTypes` for producers that also consume remotes.

Override this rule with `rules["config/nested-producer-dts-extract"]`.

## Sources

- [Official source](https://module-federation.io/configure/dts.html)
