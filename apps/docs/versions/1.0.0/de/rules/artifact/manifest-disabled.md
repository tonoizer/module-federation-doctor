<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/manifest-disabled`

- Kategorie: **tooling**
- Standardschweregrad: **warning**

## Problem

When a project has exposes or remotes but explicitly disables manifests, consumers lose metadata-powered preloading, dynamic type hints, and richer inspection. MFDoctor reports this as one warning rather than treating the deliberately disabled manifest as generic partial analysis.

## So beheben Sie das Problem

For a producer, set `manifest: true` to publish the metadata. For a consumer, point remotes at the producer's `mf-manifest.json` when those capabilities are wanted. If direct `remoteEntry.js` URLs are intentional, document that choice and turn this rule off.

Suppress or retarget with `rules["artifact/manifest-disabled"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/manifest.html)
