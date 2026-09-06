<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/promise-remote-async-boundary`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

Promise remotes resolve asynchronously. Without `experiments.asyncStartup` or an `import('./bootstrap')` boundary, the host can start before those remotes finish initializing.

## So beheben Sie das Problem

Enable `experiments.asyncStartup`, or move application startup behind a dynamic `import('./bootstrap')` (or another async app-shell import).

Suppress or retarget with `rules["config/promise-remote-async-boundary"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://module-federation.io/configure/experiments.html)
- [Official source](https://module-federation.io/guide/troubleshooting/runtime.html#runtime-005)
