<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/manifest-remote-entry-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Consumers follow manifest metadata to a remote entry that was not emitted.

## So beheben Sie das Problem

Clean and rebuild; verify output path, filename, and manifest settings.

Suppress or retarget with `rules["artifact/manifest-remote-entry-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/manifest.html)
