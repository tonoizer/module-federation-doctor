<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `reliability/vite-fixed-parse-timeout`

- Kategorie: **reliability**
- Standardschweregrad: **info**

## Problem

A busy large build can exceed a fixed timeout and produce incomplete remote/shared analysis.

## So beheben Sie das Problem

Prefer `moduleParseIdleTimeout` so only inactivity ends parsing.

Suppress or retarget with `rules["reliability/vite-fixed-parse-timeout"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
