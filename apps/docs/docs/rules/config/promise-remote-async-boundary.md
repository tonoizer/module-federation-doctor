# `config/promise-remote-async-boundary`

- Category: **correctness**
- Default severity: **warning**

## Issue

Promise remotes resolve asynchronously. Without `experiments.asyncStartup` or an `import('./bootstrap')` boundary, the host can start before those remotes finish initializing.

## How to fix it

Enable `experiments.asyncStartup`, or move application startup behind a dynamic `import('./bootstrap')` (or another async app-shell import).

Suppress or retarget with `rules["config/promise-remote-async-boundary"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://module-federation.io/configure/experiments.html)
- [Official source](https://module-federation.io/guide/troubleshooting/runtime.html#runtime-005)
