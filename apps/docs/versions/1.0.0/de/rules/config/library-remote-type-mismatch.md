<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/library-remote-type-mismatch`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

A consumer loader can fail when its remote type does not match the producer library format.

## So beheben Sie das Problem

Align `library.type`, `remoteType`, and each remote object's `type`.

Suppress or retarget with `rules["config/library-remote-type-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/library.html)
- [Official source](https://module-federation.io/configure/remotetype.html)
