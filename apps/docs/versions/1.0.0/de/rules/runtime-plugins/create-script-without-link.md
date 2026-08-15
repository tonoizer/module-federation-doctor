<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `runtime-plugins/create-script-without-link`

- Kategorie: **reliability**
- Standardschweregrad: **info**

## Problem

A createScript hook without createLink can waste preload work when link-based loading is used.

## So beheben Sie das Problem

Add createLink when preloadRemote or CSS/JS link loading is in play, or suppress if preload is unused.

Suppress or retarget with `rules["runtime-plugins/create-script-without-link"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/troubleshooting/runtime.html)
- [Official source](https://module-federation.io/guide/runtime/runtime-hooks.html)
