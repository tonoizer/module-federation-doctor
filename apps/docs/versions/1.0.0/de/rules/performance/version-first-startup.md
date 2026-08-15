<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `performance/version-first-startup`

- Kategorie: **performance**
- Standardschweregrad: **info**

## Problem

`version-first` loads all remote entries during initialization, adding startup work.

## So beheben Sie das Problem

Use `loaded-first` when on-demand loading is more important than highest-version selection.

Suppress or retarget with `rules["performance/version-first-startup"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shareStrategy.html)
