<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/copied-vite-options-on-webpack`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

Vite-only Module Federation options pasted onto Enhanced / webpack-family configs (`virtualModuleDir`, `hostInitInjectLocation`, `bundleAllCSS`, `remoteHmr`, `varFilename`) are ignored, so a copied Vite config silently no-ops.

## So beheben Sie das Problem

Remove the listed Vite-only keys from webpack, Rspack, Rsbuild, or Modern.js federation options. They are `@module-federation/vite` controls and have no Enhanced equivalent.

Suppress or retarget with `rules["config/copied-vite-options-on-webpack"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://github.com/module-federation/core)
- [Official source](https://module-federation.io/configure/index.html)
