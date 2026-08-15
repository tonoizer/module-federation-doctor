<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/lazy-plugin-unregistered`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Lazy Bridge React loading requires `@module-federation/bridge-react/plugin` in `runtimePlugins` or Bridge remotes fail at runtime.

## So beheben Sie das Problem

Add `@module-federation/bridge-react/plugin` to `runtimePlugins`. Soften with `requireRuntimePlugin: false` or turn the rule `"off"` for non-lazy Bridge setups.

Suppress or retarget with `rules["bridge/lazy-plugin-unregistered"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
- [Official source](https://module-federation.io/configure/runtimeplugins.html)
