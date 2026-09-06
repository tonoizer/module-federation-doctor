# `federation/share-strategy-mismatch`

- Category: **reliability**
- Default severity: **warning**

## Issue

Hosts and remotes that disagree on `version-first` vs `loaded-first` negotiate shared versions differently at startup. An omitted `shareStrategy` is not treated as `version-first` when comparing hosts: two omitted configs stay quiet, but omitted vs an explicit strategy is a mismatch.

## How to fix it

Pick one federation-wide `shareStrategy`, or document intentional per-app exceptions.

Suppress or retarget with `rules["federation/share-strategy-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shareStrategy.html)
