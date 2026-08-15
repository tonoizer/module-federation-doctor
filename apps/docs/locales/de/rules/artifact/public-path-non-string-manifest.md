<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/public-path-non-string-manifest`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

Module Federation skips manifest generation when bundler `output.publicPath` is not a string.

## So beheben Sie das Problem

Set `output.publicPath` to a string URL, root-relative path, or `auto` when manifests are required.

Suppress or retarget with `rules["artifact/public-path-non-string-manifest"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://github.com/module-federation/core)
