# `artifact/manifest-remote-entry-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

Consumers follow manifest metadata to a remote entry that was not emitted.

## How to fix it

Clean and rebuild; verify output path, filename, and manifest settings.

Override this rule with `rules["artifact/manifest-remote-entry-missing"]`.

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
