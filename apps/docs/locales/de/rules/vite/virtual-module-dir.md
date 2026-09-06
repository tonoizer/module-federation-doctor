<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/virtual-module-dir`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

A `virtualModuleDir` with slashes is not a single virtual folder. Nested names collide with virtual module IDs and break Vite federation bootstrap.

## So beheben Sie das Problem

Use one simple directory name without slashes, for example `__mf__`.

Suppress or retarget with `rules["vite/virtual-module-dir"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
