<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/types-metadata-missing`

- Kategorie: **tooling**
- Standardschweregrad: **warning**

## Problem

The manifest cannot advertise generated type archives to consumers.

## So beheben Sie das Problem

Fix DTS generation and ensure its metadata reaches the manifest.

Suppress or retarget with `rules["artifact/types-metadata-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://module-federation.io/configure/dts.html)
