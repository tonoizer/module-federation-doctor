# `federation/share-strategy-mismatch`

- Category: **reliability**
- Default severity: **warning**

## Issue

Hosts and remotes that disagree on `version-first` vs `loaded-first` negotiate shared versions differently at startup.

## How to fix it

Pick one federation-wide `shareStrategy`, or document intentional per-app exceptions.

Override this rule with `rules["federation/share-strategy-mismatch"]`.

## Sources

- [Official source](https://module-federation.io/configure/shareStrategy.html)
