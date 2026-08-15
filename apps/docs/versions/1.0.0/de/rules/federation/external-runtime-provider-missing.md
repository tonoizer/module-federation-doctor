<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `federation/external-runtime-provider-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

External-runtime remotes cannot start without a federation-wide provider.

## So beheben Sie das Problem

Enable `provideExternalRuntime` on one top-level pure consumer.

Suppress or retarget with `rules["federation/external-runtime-provider-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/experiments.html)
