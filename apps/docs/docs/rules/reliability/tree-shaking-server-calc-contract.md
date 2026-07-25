# `reliability/tree-shaking-server-calc-contract`

- Category: **reliability**
- Default severity: **warning**

## Issue

Server-calculated shared artifacts need a known fallback output and deployment pipeline.

## How to fix it

Set `treeShakingDir`, merge all consumer exports, and publish matching secondary artifacts.

Override this rule with `rules["reliability/tree-shaking-server-calc-contract"]`.

## Sources

- [Official source](https://module-federation.io/configure/treeShakingDir.html)
- [Official source](https://module-federation.io/configure/treeShakingSharedPlugins.html)
