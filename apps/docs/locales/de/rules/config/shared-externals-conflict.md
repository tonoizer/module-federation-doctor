<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/shared-externals-conflict`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

A library listed in both `shared` and bundler `externals` is excluded from the bundle while still declared as shared, which causes runtime failures.

## So beheben Sie das Problem

Remove the package from `shared` or from bundler `externals` (webpack/rspack `externals`, rsbuild `output.externals`). Functions and regex externals are not compared. When externals were not observed (CLI without `externals` and without an adapter), this rule skips.

Suppress or retarget with `rules["config/shared-externals-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://webpack.js.org/configuration/externals/)
- [Official source](https://rspack.rs/config/externals)
- [Official source](https://rsbuild.rs/config/output/externals)
