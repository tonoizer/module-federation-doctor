<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `federation/share-strategy-mismatch`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Hosts and remotes that disagree on `version-first` vs `loaded-first` negotiate shared versions differently at startup.

## So beheben Sie das Problem

Pick one federation-wide `shareStrategy`, or document intentional per-app exceptions.

Suppress or retarget with `rules["federation/share-strategy-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shareStrategy.html)
