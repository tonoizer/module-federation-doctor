<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `performance/vite-bundle-all-css`

- Kategorie: **performance**
- Standardschweregrad: **warning**

## Problem

Vite attaches all bundle CSS to every expose, which can duplicate transfer and style work.

## So beheben Sie das Problem

Disable `bundleAllCSS` unless every expose needs the complete stylesheet set.

Suppress or retarget with `rules["performance/vite-bundle-all-css"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
