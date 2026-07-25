# `runtime/remote-unknown`

- Category: **tooling**
- Default severity: **warning**

## Issue

The trace names a remote that is absent from loaded Doctor project facts.

## How to fix it

Collect project.json for every host and remote, or correct the remote name in the trace source.

Override this rule with `rules["runtime/remote-unknown"]`.

## Sources

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
