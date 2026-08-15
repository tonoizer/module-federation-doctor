<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/manifest-shared-version-mismatch`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Stale version metadata can choose the wrong shared provider at runtime.

## So beheben Sie das Problem

Clean output, reinstall from the lockfile, and rebuild the manifest.

Suppress or retarget with `rules["artifact/manifest-shared-version-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/manifest.html)
- [Official source](https://module-federation.io/configure/shared.html)
