<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/router-shared-conflict`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Bridge router aliases React Router; sharing `react-router` / `react-router-dom` at the same time can load duplicate router runtimes and break navigation.

## So beheben Sie das Problem

Remove React Router from `shared`, or disable Bridge router with `bridge.enableBridgeRouter: false`. Soften with `rules["bridge/router-shared-conflict"]: "off"` when intentional.

Suppress or retarget with `rules["bridge/router-shared-conflict"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
- [Official source](https://module-federation.io/configure/shared.html)
