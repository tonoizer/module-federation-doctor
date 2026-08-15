<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `federation/share-scope-mismatch`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Projects in different scopes cannot reuse the same shared provider.

## So beheben Sie das Problem

Align top-level, remote, and shared-item scopes intentionally.

Suppress or retarget with `rules["federation/share-scope-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shareScope.html)
