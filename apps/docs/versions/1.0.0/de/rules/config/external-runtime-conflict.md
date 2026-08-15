<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/external-runtime-conflict`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

The same build cannot externalize the runtime it is responsible for providing.

## So beheben Sie das Problem

Provide at the top consumer and externalize only its browser remotes.

Suppress or retarget with `rules["config/external-runtime-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/experiments.html)
