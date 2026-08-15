<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/manual-chunks-conflict`

- Kategorie: **reliability**
- Standardschweregrad: **info**

## Problem

Custom manualChunks / codeSplitting.groups can fight federation bootstrap chunk ownership and create init-order cycles. This is an advisory signal because static config cannot prove a runtime cycle for every framework.

## So beheben Sie das Problem

Keep federation runtime chunks isolated; move general splitting outside that graph or allowlist a proven layout. Treat the finding as informational until a production build or runtime trace confirms an ordering problem.

Suppress or retarget with `rules["vite/manual-chunks-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
