# `artifact/manifest-remote-entry-missing`

- Category: **correctness**
- Default severity: **error**

## Issue

Consumers follow manifest metadata to a remote entry or `ssrRemoteEntry` that was not emitted.

## How to fix it

Clean and rebuild client and SSR outputs; verify filename, output path, and manifest generation. Build the SSR environment when `ssrRemoteEntry` is advertised. If `@module-federation/vite` is below 1.23.2, upgrade so client-only builds stop advertising an SSR entry that was never emitted.

Suppress or retarget with `rules["artifact/manifest-remote-entry-missing"]` set to `"off"` or a severity, see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/configure/manifest.html)
