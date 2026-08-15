<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/duplicate-plugin-registration`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Registering Module Federation more than once on the same compiler breaks the core singleton contract.

## So beheben Sie das Problem

Keep a single Module Federation plugin instance per compiler.

Suppress or retarget with `rules["config/duplicate-plugin-registration"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/core)
- [Official source](https://module-federation.io/guide/installation.html)
