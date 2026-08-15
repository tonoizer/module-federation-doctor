<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `doctor/partial-analysis`

- Kategorie: **tooling**
- Standardschweregrad: **warning**

## Problem

Missing facts, unresolved dynamic imports, unreadable source files recorded in `imports.sourceReadFailures`, budget-limited persisted projects, or omitted workspace projects reduce confidence and can hide relevant findings. Source read failures make project or workspace input `unknown`; a pure analysis-budget cutoff is `partial`. Incomplete workspace evidence suppresses absence-based federation rules (`host-gaps`, `ghost-shares`, `missing-provider`, and `external-runtime-provider-missing`) while positive mismatches remain useful. Package-capable unresolved dynamics suppress workspace absence certainty without changing the ordinary project exit code.

## So beheben Sie das Problem

When MF options are missing, pass them explicitly. On Vite, missing `mf-manifest.json` / `mf-stats.json` usually means enable `manifest: true` — not missing options; an explicit `manifest: false` is reported by `artifact/manifest-disabled` instead. Fix source permissions or transient read races when `imports.sourceReadFailures` is present, or raise the analysis budget when only a budget cutoff made the workspace `partial`. Prefer string-literal dynamic imports or an opt-in runtime trace when analysis is incomplete.

Suppress or retarget with `rules["doctor/partial-analysis"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/index.html)
