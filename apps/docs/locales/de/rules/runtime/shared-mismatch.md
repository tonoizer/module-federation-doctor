<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `runtime/shared-mismatch`

- Kategorie: **reliability**
- Standardschweregrad: **error**

## Problem

Runtime shared selection conflicts with installed versions, required ranges, or provider config.

## So beheben Sie das Problem

Align shared versions, singleton/import settings, and providers across hosts and remotes.

Suppress or retarget with `rules["runtime/shared-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/plugin/plugins/observability-plugin)
- [Official source](https://module-federation.io/configure/shared.html)
