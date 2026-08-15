<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/eager-tree-shaking-conflict`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Eager modules live in the initial entry and cannot use the on-demand shared tree-shaking path.

## So beheben Sie das Problem

Choose eager loading for small dependencies or tree shaking for larger libraries.

Suppress or retarget with `rules["config/eager-tree-shaking-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://github.com/module-federation/vite)
