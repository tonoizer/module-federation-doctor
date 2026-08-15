<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/tanstack-router-conflict`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

Bridge router aliasing plus `@tanstack/react-router` can duplicate navigation ownership in one app.

## So beheben Sie das Problem

Disable Bridge router or isolate TanStack Router, or set `rules["bridge/tanstack-router-conflict"]` to `"off"`.

Suppress or retarget with `rules["bridge/tanstack-router-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
