<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `shared/unused`

- Kategorie: **performance**
- Standardschweregrad: **warning**

## Problem

Unused shared declarations add runtime bookkeeping and can signal stale config.

## So beheben Sie das Problem

Remove stale entries, or ensure usage is visible via static imports, string-literal `import()` / `loadShare`, or an opt-in Observability runtime trace.

Suppress or retarget with `rules["shared/unused"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
