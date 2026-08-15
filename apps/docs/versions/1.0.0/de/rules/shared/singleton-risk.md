<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `shared/singleton-risk`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Multiple framework runtimes can split global state, contexts, hooks, or renderers.

## So beheben Sie das Problem

Share stateful framework runtimes as singletons and align their versions.

Suppress or retarget with `rules["shared/singleton-risk"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
