<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/get-public-path-unused`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

`getPublicPath` has no effect on a consumer that exposes no modules.

## So beheben Sie das Problem

Remove dead config or move it to the producer that owns the assets.

Suppress or retarget with `rules["config/get-public-path-unused"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/getpublicpath.html)
