<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/share-scope-undeclared`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

A dependency placed in a scope the container does not initialize cannot be reused there.

## So beheben Sie das Problem

Declare the scope at top level or move the shared item into an initialized scope.

Suppress or retarget with `rules["config/share-scope-undeclared"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shareScope.html)
