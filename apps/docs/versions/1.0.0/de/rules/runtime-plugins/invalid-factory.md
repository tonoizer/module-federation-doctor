<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `runtime-plugins/invalid-factory`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

A runtime plugin without a factory or usable `name` is ignored at runtime (silent no-op).

## So beheben Sie das Problem

Export a factory or plugin object that includes a stable `name` plus the hooks you intend to run.

Suppress or retarget with `rules["runtime-plugins/invalid-factory"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/runtimeplugins.html)
- [Official source](https://module-federation.io/guide/runtime/runtime-plugins.html)
