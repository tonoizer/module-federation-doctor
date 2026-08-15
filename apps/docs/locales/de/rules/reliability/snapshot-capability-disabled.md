<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `reliability/snapshot-capability-disabled`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Snapshot removal disables manifest remotes, preload, dynamic type hints, HMR, and DevTools data.

## So beheben Sie das Problem

Enable snapshots when those features are part of the deployment contract.

Suppress or retarget with `rules["reliability/snapshot-capability-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://github.com/module-federation/core)
