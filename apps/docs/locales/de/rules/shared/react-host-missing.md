<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `shared/react-host-missing`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

A React host that loads remotes without sharing its imported React runtime can create separate React or renderer instances across the federation graph.

## So beheben Sie das Problem

Declare imported `react` and `react-dom` packages as singleton shared dependencies, for example `{ singleton: true }`, or suppress the rule when the separate runtime is intentional.

Suppress or retarget with `rules["shared/react-host-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
