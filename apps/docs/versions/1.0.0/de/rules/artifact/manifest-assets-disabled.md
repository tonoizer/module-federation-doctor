<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/manifest-assets-disabled`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Disabled asset analysis removes shared and expose asset details from producer metadata.

## So beheben Sie das Problem

Enable asset analysis for production producer manifests.

Suppress or retarget with `rules["artifact/manifest-assets-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://github.com/module-federation/vite)
