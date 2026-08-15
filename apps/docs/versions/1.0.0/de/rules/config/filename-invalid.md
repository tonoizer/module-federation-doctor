<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/filename-invalid`

- Kategorie: **security**
- Standardschweregrad: **error**

## Problem

Unsafe paths can escape output layout; a non-JavaScript entry cannot run as a container.

## So beheben Sie das Problem

Use a relative `.js` or `.mjs` filename without absolute or `..` segments.

Suppress or retarget with `rules["config/filename-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/filename.html)
