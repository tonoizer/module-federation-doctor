<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/runtime-plugin-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

A missing runtime plugin stops injected runtime behavior from loading.

## So beheben Sie das Problem

Correct the path/package and include local plugin files in the MFDoctor scan.

Suppress or retarget with `rules["config/runtime-plugin-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/runtimeplugins.html)
