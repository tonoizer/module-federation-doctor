<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/async-boundary-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

A host entry that synchronously imports non-eager shared packages can hit RUNTIME-005 (`loadShareSync`) because Module Federation needs an async boundary before shared negotiation finishes.

## So beheben Sie das Problem

Move app startup behind a dynamic import (for example `import('./bootstrap')`), enable `experiments.asyncStartup`, or mark those shared packages `eager: true` when intentional.

Suppress or retarget with `rules["config/async-boundary-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/troubleshooting/runtime.html#runtime-005)
- [Official source](https://module-federation.io/configure/experiments.html)
- [Official source](https://module-federation.io/configure/shared.html)
