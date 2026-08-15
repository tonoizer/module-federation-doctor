<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/public-path-suspicious`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

A malformed asset base makes remote chunks and styles resolve from the wrong URL.

## So beheben Sie das Problem

Use `auto`, a root-relative path, HTTPS URL, or reviewed dynamic getter.

Suppress or retarget with `rules["artifact/public-path-suspicious"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/getpublicpath.html)
