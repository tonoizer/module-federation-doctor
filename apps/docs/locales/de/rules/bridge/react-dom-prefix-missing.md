<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/react-dom-prefix-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Bridge React v18/v19 needs `react-dom/` (or `react-dom/client`) in `shared` so renderer subpaths negotiate one copy across host and remote.

## So beheben Sie das Problem

Add `'react-dom/': { singleton: true, ... }` (or `react-dom/client`) to `shared`. Disable with `requireReactDomPrefix: false` or `rules["bridge/react-dom-prefix-missing"]: "off"` when intentional.

Suppress or retarget with `rules["bridge/react-dom-prefix-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
- [Official source](https://module-federation.io/configure/shared.html)
