<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/disable-alias-deprecated`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

`bridge.disableAlias` is a deprecated escape hatch; explicit `enableBridgeRouter` communicates intent clearly.

## So beheben Sie das Problem

Prefer `enableBridgeRouter: false` (or true) over `disableAlias`, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/disable-alias-deprecated"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
