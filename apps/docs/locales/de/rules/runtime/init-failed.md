<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `runtime/init-failed`

- Kategorie: **reliability**
- Standardschweregrad: **error**

## Problem

Container initialization failed before exposes or shared resolution could finish.

## So beheben Sie das Problem

Verify async startup, external runtime provider order, and runtime plugins against MFDoctor project facts.

Suppress or retarget with `rules["runtime/init-failed"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
- [Official source](https://module-federation.io/configure/experiments.html)
