# `bridge/react-version-entry-prefer`

- Category: **reliability**
- Default severity: **warning**

## Issue

The bare `@module-federation/bridge-react` entry can pick the wrong React Bridge API when the React major is known.

## How to fix it

Import `@module-federation/bridge-react/v18` or `/v19` to match your React major. Override majors with `reactMajors`, or set the rule to `"off"` when the bare entry is intentional.

Suppress or retarget with `rules["bridge/react-version-entry-prefer"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
