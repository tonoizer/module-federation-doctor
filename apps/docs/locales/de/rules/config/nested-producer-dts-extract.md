<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/nested-producer-dts-extract`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

A remote that both exposes modules and consumes remotes publishes an incomplete type archive unless `dts.generateTypes.extractRemoteTypes` is enabled, so nested consumers miss types from inner remotes.

## So beheben Sie das Problem

Enable `dts.generateTypes.extractRemoteTypes` on nested producers. Host-only consumers do not need this flag.

Suppress or retarget with `rules["config/nested-producer-dts-extract"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/dts.html)
