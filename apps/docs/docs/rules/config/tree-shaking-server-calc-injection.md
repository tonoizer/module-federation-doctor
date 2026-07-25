# `config/tree-shaking-server-calc-injection`

- Category: **correctness**
- Default severity: **warning**

## Issue

Runtime-injected used exports conflict with the deployment-owned `server-calc` contract.

## How to fix it

Disable injection and let the deployment service merge consumer export metadata.

Override this rule with `rules["config/tree-shaking-server-calc-injection"]`.

## Sources

- [Official source](https://module-federation.io/configure/injectTreeShakingUsedExports.html)
