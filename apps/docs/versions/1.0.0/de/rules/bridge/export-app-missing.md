<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/export-app-missing`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Bridge producers without `./export-app` break the conventional Bridge remote contract expected by hosts.

## So beheben Sie das Problem

Expose `"./export-app"` via `createBridgeComponent` (render/destroy), or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/export-app-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
