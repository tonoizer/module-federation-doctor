<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/remote-hmr-dev`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

Without `remoteHmr`, local Vite remotes miss cross-container hot updates.

## So beheben Sie das Problem

Enable `remoteHmr` in development profiles when remotes/exposes are active.

Suppress or retarget with `rules["vite/remote-hmr-dev"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
