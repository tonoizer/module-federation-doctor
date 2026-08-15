<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/manifest-invalid`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

The runtime and tooling cannot consume malformed or incomplete manifest JSON.

## So beheben Sie das Problem

Rebuild the manifest and verify `metaData`, `exposes`, and `shared` are present.

Suppress or retarget with `rules["artifact/manifest-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://github.com/module-federation/core)
