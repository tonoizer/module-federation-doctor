<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `shared/prefix-share-recommended`

- Kategorie: **performance**
- Standardschweregrad: **error**

## Problem

Observed `react/...` or `react-dom/...` imports are not covered by the root shared key, so framework subpaths can bypass shared-scope negotiation and create duplicate renderer/runtime modules. Bridge projects use the focused `bridge/react-dom-prefix-missing` contract instead of this rule.

## So beheben Sie das Problem

Add `"react/"` / `"react-dom/"` to `shared`, or add only the exact observed subpaths. Turn `rules["shared/prefix-share-recommended"]` off or baseline the fingerprint when the import boundary is intentional.

Suppress or retarget with `rules["shared/prefix-share-recommended"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://module-federation.io/guide/bridge/react-bridge)
