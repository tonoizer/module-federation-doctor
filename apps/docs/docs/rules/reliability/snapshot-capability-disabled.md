# `reliability/snapshot-capability-disabled`

- Category: **reliability**
- Default severity: **warning**

## Issue

Snapshot removal disables manifest remotes, preload, dynamic type hints, HMR, and DevTools data.

## How to fix it

Enable snapshots when those features are part of the deployment contract.

Override this rule with `rules["reliability/snapshot-capability-disabled"]`.

## Sources

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://github.com/module-federation/core)
