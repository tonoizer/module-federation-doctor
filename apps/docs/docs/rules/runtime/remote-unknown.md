# `runtime/remote-unknown`

- Category: **tooling**
- Default severity: **warning**

## Issue

The trace names a remote that is absent from loaded MFDoctor project facts.

## How to fix it

Collect project.json for every host and remote, or correct the remote name in the trace source.

Suppress or retarget with `rules["runtime/remote-unknown"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
