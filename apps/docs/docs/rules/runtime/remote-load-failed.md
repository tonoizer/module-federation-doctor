# `runtime/remote-load-failed`

- Category: **reliability**
- Default severity: **error**

## Issue

A browser Observability trace failed while loading a remote manifest, entry, expose, or factory.

## How to fix it

Compare the redacted entry URL and manifest metadata with the producer build output.

Override this rule with `rules["runtime/remote-load-failed"]`.

## Sources

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
