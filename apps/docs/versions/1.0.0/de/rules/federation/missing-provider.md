<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `federation/missing-provider`

- Kategorie: **reliability**
- Standardschweregrad: **error**

## Problem

Every consumer disabled its fallback, so no build can provide the package.

## So beheben Sie das Problem

Let at least one build provide the package or restore a local fallback.

Suppress or retarget with `rules["federation/missing-provider"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
