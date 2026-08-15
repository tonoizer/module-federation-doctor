<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `reliability/version-first-offline-remotes`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

An unavailable remote can break startup before its exposed module is requested. The `demo` policy only softens this recommendation when every remote is an explicitly known-local bare/relative entry or loopback URL during development; external, authenticated non-loopback, unknown, and CI remotes remain visible.

## So beheben Sie das Problem

Use `loaded-first` when delayed remote failure is acceptable, or keep `version-first` and add `@module-federation/retry-plugin` / an `errorLoadRemote` recovery plugin. A runtime plugin that deliberately sets `shareStrategy` to `loaded-first` (including Modern's shared-strategy plugin) is treated as the loaded-first choice.

Suppress or retarget with `rules["reliability/version-first-offline-remotes"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shareStrategy.html)
- [Official source](https://module-federation.io/configure/runtimeplugins.html)
- [Official source](https://github.com/module-federation/core/tree/main/packages/retry-plugin)
