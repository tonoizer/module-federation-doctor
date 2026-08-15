<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/expose-key-invalid`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Consumers cannot address an expose whose public key does not follow the `./Name` form.

## So beheben Sie das Problem

Rename the key to start with `./` and update consumer imports.

Suppress or retarget with `rules["config/expose-key-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/exposes.html)
