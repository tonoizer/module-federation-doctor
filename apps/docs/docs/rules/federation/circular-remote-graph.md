# `federation/circular-remote-graph`

- Category: **correctness**
- Default severity: **error**

## Issue

Circular remotes can deadlock nested container initialization and type extraction.

## How to fix it

Break the cycle so remotes form a DAG, or isolate shared code outside the remote graph.

Override this rule with `rules["federation/circular-remote-graph"]`.

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://github.com/module-federation/core)
