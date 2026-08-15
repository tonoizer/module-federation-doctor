<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/missing-fallback-loading`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Bridge remotes without `fallback`/`loading` leave consumers with a blank screen while the remote loads or fails.

## So beheben Sie das Problem

Pass `fallback` and `loading` to `createRemoteAppComponent`, or set `rules["bridge/missing-fallback-loading"]` to `"off"`.

Suppress or retarget with `rules["bridge/missing-fallback-loading"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
