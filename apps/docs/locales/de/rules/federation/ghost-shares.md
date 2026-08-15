<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `federation/ghost-shares`

- Kategorie: **performance**
- Standardschweregrad: **info**

## Problem

A package is declared in `shared` by only one project and is unused elsewhere in the federation graph, creating one-sided version coupling.

## So beheben Sie das Problem

Remove the unused shared entry, or add matching `shared` declarations where other projects actually consume the package.

Suppress or retarget with `rules["federation/ghost-shares"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
