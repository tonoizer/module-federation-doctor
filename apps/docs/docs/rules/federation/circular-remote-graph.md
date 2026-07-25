# `federation/circular-remote-graph`

- Category: **correctness**
- Default severity: **error**

## Issue

Circular remotes can deadlock nested container initialization and type extraction.

## How to fix it

Break the cycle so remotes form a DAG, or isolate shared code outside the remote graph.

Suppress or retarget with `rules["federation/circular-remote-graph"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://github.com/module-federation/core)
