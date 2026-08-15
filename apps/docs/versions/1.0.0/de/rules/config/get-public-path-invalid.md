<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/get-public-path-invalid`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

The runtime cannot evaluate an invalid stringified public-path function.

## So beheben Sie das Problem

Use a stringified function, arrow function, or return statement.

Suppress or retarget with `rules["config/get-public-path-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/getpublicpath.html)
