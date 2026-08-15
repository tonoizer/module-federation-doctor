<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/react-version-entry-mismatch`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Importing `@module-federation/bridge-react/v18` against React 19 (or the reverse) selects the wrong Bridge API surface and can fail at runtime.

## So beheben Sie das Problem

Align the Bridge entry with the installed React major (`/v18` or `/v19`). Limit majors with `reactMajors`, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/react-version-entry-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
