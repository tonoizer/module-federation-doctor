<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `reliability/async-startup-library-promise`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Async startup changes synchronous library entry exports into a Promise contract.

## So beheben Sie das Problem

Make consumers await it or keep synchronous startup for that library.

Suppress or retarget with `rules["reliability/async-startup-library-promise"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/experiments.html)
