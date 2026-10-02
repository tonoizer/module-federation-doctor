<!-- mfdoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche mfdoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/expose-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

The config promises an expose that the emitted manifest does not contain.

## So beheben Sie das Problem

Rebuild the producer so the expose lands in `mf-manifest.json`, or remove the stale `exposes` key from the Module Federation config.

Suppress or retarget with `rules["artifact/expose-missing"]` set to `"off"` or a severity, see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/exposes.html)
- [Official source](https://module-federation.io/configure/manifest.html)
