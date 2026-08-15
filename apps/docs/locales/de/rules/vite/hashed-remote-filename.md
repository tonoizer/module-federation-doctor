<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/hashed-remote-filename`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Hashed remote entry filenames invalidate consumer URLs whenever the producer rebuilds.

## So beheben Sie das Problem

Use a stable `filename` such as `remoteEntry.js` for the container entry.

Suppress or retarget with `rules["vite/hashed-remote-filename"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
- [Official source](https://module-federation.io/configure/filename.html)
