<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/remote-entry-invalid`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

The runtime cannot resolve a remote without a usable entry or manifest address.

## So beheben Sie das Problem

Use a valid URL/object entry or the `name@url` form supported by the bundler.

Suppress or retarget with `rules["config/remote-entry-invalid"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/remotes.html)
