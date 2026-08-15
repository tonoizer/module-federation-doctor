<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `performance/asset-budget`

- Kategorie: **performance**
- Standardschweregrad: **warning**

## Problem

Federation assets that exceed project budgets slow startup and transfer more bytes than planned. Overlapping manifest groups are merged before the comparison so one physical asset is not counted twice.

## So beheben Sie das Problem

Reduce the oversized entry, expose, or shared assets, or raise `rules["performance/asset-budget"]` byte limits. Review the reported asset list before changing the budget.

Suppress or retarget with `rules["performance/asset-budget"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://module-federation.io/configure/shareStrategy.html)
