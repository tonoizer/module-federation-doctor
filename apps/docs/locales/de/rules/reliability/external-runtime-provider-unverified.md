<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `reliability/external-runtime-provider-unverified`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

A remote fails if `_FEDERATION_RUNTIME_CORE` is absent or initialized too late.

## So beheben Sie das Problem

Verify a pure top consumer provides the runtime before remote execution.

Suppress or retarget with `rules["reliability/external-runtime-provider-unverified"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/experiments.html)
