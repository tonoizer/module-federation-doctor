<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/plugin-package-mismatch`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

Using the wrong integration can skip required bundler hooks and runtime generation. On Rspack, leftover `@module-federation/rspack` (alone or mixed with `@module-federation/enhanced`) misses Enhanced options such as asyncStartup.

## So beheben Sie das Problem

Use the official package for Vite, Rspack, Rsbuild, Webpack, or Modern.js. For Rspack, depend on `@module-federation/enhanced` (or `@module-federation/enhanced/rspack`) and remove leftover `@module-federation/rspack`.

Suppress or retarget with `rules["config/plugin-package-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/integrations/index.html)
- [Official source](https://module-federation.io/integrations/build-tool/rspack)
