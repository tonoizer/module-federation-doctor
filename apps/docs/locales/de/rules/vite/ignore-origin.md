<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/ignore-origin`

- Kategorie: **reliability**
- Standardschweregrad: **info**

## Problem

`ignoreOrigin` changes proxy entry origin behavior. Without a tested Vite `server.origin`, remote URLs can resolve against the wrong host.

## So beheben Sie das Problem

Set Vite `server.origin` to the public deployment base you tested, or turn `ignoreOrigin` off. CLI/config-only analysis without a plugin origin fact stays unknown rather than claiming a pass.

Suppress or retarget with `rules["vite/ignore-origin"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
