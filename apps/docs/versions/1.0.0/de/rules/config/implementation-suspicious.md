<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/implementation-suspicious`

- Kategorie: **reliability**
- Standardschweregrad: **info**

## Problem

A custom implementation can violate the runtime contract expected by the build plugin.

## So beheben Sie das Problem

Use a compatible `@module-federation/runtime-tools` path and pin compatible versions.

Suppress or retarget with `rules["config/implementation-suspicious"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/implementation.html)
