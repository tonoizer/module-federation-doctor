<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/js-remote-without-type-urls`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Hosts that consume types cannot resolve a stable type archive URL from a direct `.js` remote entry. Manifest remotes publish type metadata; otherwise `consumeTypes.remoteTypeUrls` must name the zip/api URLs.

## So beheben Sie das Problem

Point remotes at `mf-manifest.json`, or set `dts.consumeTypes.remoteTypeUrls` for each direct `.js` remote. Disable `dts.consumeTypes` when the host does not consume federated types.

Suppress or retarget with `rules["config/js-remote-without-type-urls"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/dts.html)
- [Official source](https://module-federation.io/configure/remotes.html)
