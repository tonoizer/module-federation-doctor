<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/provider-shape-invalid`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Incomplete `createRemoteAppComponent` / `createBridgeComponent` options omit required loader/module or root component contracts and break Bridge remotes.

## So beheben Sie das Problem

Pass a complete options object (loader/module for consumers, or a root component for export-app). Fallback/loading UX is covered by `bridge/missing-fallback-loading`. Turn the rule `"off"` when source facts are too thin or the call shape is dynamic.

Suppress or retarget with `rules["bridge/provider-shape-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
