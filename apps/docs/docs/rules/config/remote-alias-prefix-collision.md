# `config/remote-alias-prefix-collision`

- Category: **correctness**
- Default severity: **error**

## Issue

An alias that prefixes another remote name/alias makes multi-level path references ambiguous and is rejected by the runtime.

## How to fix it

Rename aliases so none is a prefix of another remote name or alias.

Suppress or retarget with `rules["config/remote-alias-prefix-collision"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://github.com/module-federation/core)
