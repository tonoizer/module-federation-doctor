<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/remote-capability-disabled`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Tree-shaken remote-consumption code cannot load configured remotes.

## So beheben Sie das Problem

Remove `disableRemote` or remove all consumed remotes.

Suppress or retarget with `rules["config/remote-capability-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://github.com/module-federation/core)
