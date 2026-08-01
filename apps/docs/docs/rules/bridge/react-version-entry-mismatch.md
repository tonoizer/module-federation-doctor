# `bridge/react-version-entry-mismatch`

- Category: **correctness**
- Default severity: **error**

## Issue

Importing `@module-federation/bridge-react/v18` against React 19 (or the reverse) selects the wrong Bridge API surface and can fail at runtime.

## How to fix it

Align the Bridge entry with the installed React major (`/v18` or `/v19`). Limit majors with `reactMajors`, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/react-version-entry-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
