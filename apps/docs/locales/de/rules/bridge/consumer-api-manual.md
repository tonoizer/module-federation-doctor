<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/consumer-api-manual`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Hand-rolled `loadRemote` / remote mounts skip Bridge lifecycle helpers and lose documented loading/error contracts.

## So beheben Sie das Problem

Prefer `createRemoteAppComponent` / `createBridge` from `@module-federation/bridge-react`, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/consumer-api-manual"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
