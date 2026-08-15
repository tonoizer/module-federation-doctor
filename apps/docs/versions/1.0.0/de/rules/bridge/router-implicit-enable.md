<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/router-implicit-enable`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

Rspack may auto-enable Bridge router when the Bridge package is present; leaving `bridge.enableBridgeRouter` implicit hides the routing contract from reviewers and CI.

## So beheben Sie das Problem

Set `bridge: { enableBridgeRouter: true }` (or `false`) explicitly. Allow demos to stay implicit with `allowImplicitBridgeRouter: true` or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/router-implicit-enable"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
