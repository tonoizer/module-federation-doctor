<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/external-runtime-with-exposes`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

A runtime provider is only supported on a pure consumer and the upstream plugin throws otherwise.

## So beheben Sie das Problem

Move `provideExternalRuntime` to the top consumer or remove exposes.

Suppress or retarget with `rules["config/external-runtime-with-exposes"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/experiments.html)
