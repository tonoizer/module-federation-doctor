<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `runtime/error-correlated`

- Kategorie: **reliability**
- Standardschweregrad: **error**

## Problem

A stable RUNTIME error code from an imported browser trace was matched to offline build evidence.

## So beheben Sie das Problem

Use the RUNTIME code with the matched build facts; do not infer browser behavior from static analysis alone.

Suppress or retarget with `rules["runtime/error-correlated"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
