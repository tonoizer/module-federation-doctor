<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/dts-output-dir-mismatch`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

A nested remote-entry `filename` that disagrees with `dts.generateTypes.outputDir` can publish type archives to the wrong path.

## So beheben Sie das Problem

Align `filename` directory layout with `dts.generateTypes.outputDir`, or keep both at the output root.

Suppress or retarget with `rules["config/dts-output-dir-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/dts.html)
- [Official source](https://module-federation.io/configure/filename.html)
