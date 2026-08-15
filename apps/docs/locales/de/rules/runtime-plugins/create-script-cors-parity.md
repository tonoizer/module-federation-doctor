<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `runtime-plugins/create-script-cors-parity`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

CORS on createScript without matching createLink makes preload and load use different cache keys.

## So beheben Sie das Problem

Mirror crossorigin (and credentials where applicable) on createLink; keep fetch credentials consistent.

Suppress or retarget with `rules["runtime-plugins/create-script-cors-parity"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/troubleshooting/runtime.html)
- [Official source](https://module-federation.io/guide/runtime/runtime-hooks.html)
