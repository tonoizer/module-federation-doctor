<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/alias-share-bypass`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

Webpack/Rspack/Rsbuild resolve.alias can rewrite imports around the share scope and duplicate singleton packages.

## So beheben Sie das Problem

Remove the overlapping alias, drop the package from shared, or allowlist intentional bypasses via `allowPackages`. Function aliases stay unknown.

Suppress or retarget with `rules["config/alias-share-bypass"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://webpack.js.org/configuration/resolve/#resolvealias)
- [Official source](https://rspack.rs/config/resolve#resolvealias)
- [Official source](https://rsbuild.rs/config/resolve/alias)
