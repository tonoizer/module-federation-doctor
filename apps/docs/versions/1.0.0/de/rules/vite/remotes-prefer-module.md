<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/remotes-prefer-module`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

Vite string remotes and missing/`var` type default to script-style loading. Vite↔Vite ESM remotes need explicit `type: 'module'`; mixed bundlers should declare an explicit non-default type (for example `global`) or document a `varFilename` producer interop path.

## So beheben Sie das Problem

Prefer object remotes with `type: 'module'` for Vite↔Vite ESM. For webpack/rspack remotes, set an explicit type such as `global`, or keep `varFilename` when this app intentionally emits a var entry for var hosts.

Suppress or retarget with `rules["vite/remotes-prefer-module"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://module-federation.io/configure/remotes.html)
