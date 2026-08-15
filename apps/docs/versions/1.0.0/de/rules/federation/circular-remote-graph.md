<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `federation/circular-remote-graph`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

A remote cycle is valid Module Federation topology by itself. MFDoctor warns only when a strongly connected group contains a `version-first` member that eagerly loads a remote during startup.

## So beheben Sie das Problem

Keep valid `loaded-first` bi-directional setups. For a risky cycle, use `loaded-first`, add startup fallback handling, or make the remote edge on the startup path lazy.

Suppress or retarget with `rules["federation/circular-remote-graph"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shareStrategy.html)
- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://github.com/module-federation/module-federation-examples/tree/master/bi-directional)
