<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `reliability/tree-shaking-server-calc-contract`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Server-calculated shared artifacts need a known fallback output and deployment pipeline.

## So beheben Sie das Problem

Set `treeShakingDir`, merge all consumer exports, and publish matching secondary artifacts.

Suppress or retarget with `rules["reliability/tree-shaking-server-calc-contract"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/treeShakingDir.html)
- [Official source](https://module-federation.io/configure/treeShakingSharedPlugins.html)
