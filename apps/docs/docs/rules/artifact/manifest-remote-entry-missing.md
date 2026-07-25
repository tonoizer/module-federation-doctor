# `artifact/manifest-remote-entry-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

Consumers follow manifest metadata to a remote entry that was not emitted.

## How to fix it

Clean and rebuild; verify output path, filename, and manifest settings.

Suppress or retarget with `rules["artifact/manifest-remote-entry-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
