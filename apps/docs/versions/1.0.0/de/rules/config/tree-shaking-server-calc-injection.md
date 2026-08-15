<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/tree-shaking-server-calc-injection`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

Runtime-injected used exports conflict with the deployment-owned `server-calc` contract.

## So beheben Sie das Problem

Disable injection and let the deployment service merge consumer export metadata.

Suppress or retarget with `rules["config/tree-shaking-server-calc-injection"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/injectTreeShakingUsedExports.html)
