# `federation/circular-remote-graph`

- Category: **reliability**
- Default severity: **warning**

## Issue

A remote cycle is valid Module Federation topology by itself. MFDoctor warns only when a strongly connected group contains a `version-first` member that eagerly loads a remote during startup.

## How to fix it

Keep valid `loaded-first` bi-directional setups. For a risky cycle, use `loaded-first`, add startup fallback handling, or make the remote edge on the startup path lazy.

Suppress or retarget with `rules["federation/circular-remote-graph"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/shareStrategy.html)
- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://github.com/module-federation/module-federation-examples/tree/master/bi-directional)
