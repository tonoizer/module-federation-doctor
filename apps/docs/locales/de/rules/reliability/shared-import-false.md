<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `reliability/shared-import-false`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

With `import: false`, a federation participant has no local fallback if another provider is missing. When workspace evidence shows no provider at all, `federation/missing-provider` owns that finding instead.

## So beheben Sie das Problem

Guarantee a provider loads first or restore a local fallback.

Suppress or retarget with `rules["reliability/shared-import-false"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
