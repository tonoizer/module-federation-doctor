<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `federation/host-gaps`

- Kategorie: **performance**
- Standardschweregrad: **warning**

## Problem

A package used by two or more federation projects is missing from every `shared` config, so each app may bundle its own copy.

## So beheben Sie das Problem

Add the package to `shared` (usually as a singleton) in every participating project that imports it.

Suppress or retarget with `rules["federation/host-gaps"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
