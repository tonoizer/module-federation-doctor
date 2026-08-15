<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/transform-import-share-conflict`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

transformImport (or equivalent) can rewrite packages that are also shared, bypassing or duplicating the share scope.

## So beheben Sie das Problem

Remove the rewrite, exclude the package from shared, or allowlist intentional bypasses via `allowPackages`.

Suppress or retarget with `rules["config/transform-import-share-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://modernjs.dev/guides/basic-features/alias.html)
- [Official source](https://rsbuild.rs/config/source/transform-import)
