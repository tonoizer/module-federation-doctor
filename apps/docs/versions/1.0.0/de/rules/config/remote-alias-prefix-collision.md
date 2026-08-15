<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/remote-alias-prefix-collision`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

An alias that prefixes another remote name/alias makes multi-level path references ambiguous and is rejected by the runtime.

## So beheben Sie das Problem

Rename aliases so none is a prefix of another remote name or alias.

Suppress or retarget with `rules["config/remote-alias-prefix-collision"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://github.com/module-federation/core)
