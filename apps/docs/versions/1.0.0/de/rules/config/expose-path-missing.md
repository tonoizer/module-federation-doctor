<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/expose-path-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

The producer build cannot include a module that does not exist at the configured path.

## So beheben Sie das Problem

Correct the path, including its exact extension, or create the source file.

Suppress or retarget with `rules["config/expose-path-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/exposes.html)
