<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/copied-webpack-options-on-vite`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

Webpack ModuleFederationPlugin-only options pasted onto `@module-federation/vite` are ignored or misinterpreted, which leads to silent mis-shares or runtime crashes after a webpack-to-Vite migration.

## So beheben Sie das Problem

Remove the listed webpack-only keys. Prefer the Vite equivalent when one exists (`remotes.<name>.type` for `remoteType`; top-level `disableRemote` / `disableShared` / `disableSnapshot` / `target` for `experiments.optimization.*`). Keys without a Vite equivalent are not applicable and should be deleted.

Suppress or retarget with `rules["config/copied-webpack-options-on-vite"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://module-federation.io/configure/remotetype.html)
- [Official source](https://module-federation.io/configure/experiments.html)
- [Official source](https://github.com/module-federation/core)
