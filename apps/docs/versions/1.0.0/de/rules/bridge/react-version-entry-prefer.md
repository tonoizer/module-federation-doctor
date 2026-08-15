<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/react-version-entry-prefer`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

The bare `@module-federation/bridge-react` entry can pick the wrong React Bridge API when the React major is known.

## So beheben Sie das Problem

Import `@module-federation/bridge-react/v18` or `/v19` to match your React major. Override majors with `reactMajors`, or set the rule to `"off"` when the bare entry is intentional.

Suppress or retarget with `rules["bridge/react-version-entry-prefer"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
