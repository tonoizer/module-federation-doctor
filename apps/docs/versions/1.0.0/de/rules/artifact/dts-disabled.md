<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/dts-disabled`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

When a producer exposes modules but explicitly disables DTS, consumers receive no automatic checked declaration contract for those modules.

## So beheben Sie das Problem

Set `dts: true` (or enable `dts.generateTypes`). If another declaration delivery path is intentional, document and test it, then turn this rule off for that project.

Suppress or retarget with `rules["artifact/dts-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/dts.html)
