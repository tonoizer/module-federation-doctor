# `config/async-startup-rspack-version`

- Category: **correctness**
- Default severity: **warning**

## Issue

`experiments.asyncStartup` is a no-op (or a silent break) on Rspack versions that do not implement it. Enabling the flag then skips the manual async-boundary check while the bundler still starts synchronously.

## How to fix it

Upgrade `@rspack/core` to a version greater than 1.7.4, or disable `experiments.asyncStartup` until the bundler can honor it.

Suppress or retarget with `rules["config/async-startup-rspack-version"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/experiments.html)
- [Official source](https://module-federation.io/blog/hoisted-runtime.md)
- [Official source](https://github.com/web-infra-dev/rspack/pull/11899)
