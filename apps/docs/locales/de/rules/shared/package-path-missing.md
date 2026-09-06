<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `shared/package-path-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

`shared[pkg].packagePath` redirects where the bundler reads the shared package (version, singleton fallback). A path that is missing on disk makes version/singleton negotiation fail at build or runtime with no other MFDoctor finding.

## So beheben Sie das Problem

Point `packagePath` at an existing package directory or entry file (relative to the project root, or an absolute path). Remove the field when Node module resolution should be used instead. Unknown bundlers skip this check rather than inventing a disk finding.

Suppress or retarget with `rules["shared/package-path-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://github.com/originjs/vite-plugin-federation/blob/main/README.md)
