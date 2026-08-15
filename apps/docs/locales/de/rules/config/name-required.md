<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/name-required`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

The runtime uses the container name for global state and module lookup. Official plugins also reject a missing name at startup, so MFDoctor keeps this for offline checks rather than a showcase fixture.

## So beheben Sie das Problem

Set `name` to a stable, federation-wide unique id such as "host" or "shop".

Suppress or retarget with `rules["config/name-required"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/name.html)
