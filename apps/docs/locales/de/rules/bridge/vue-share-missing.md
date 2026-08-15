<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/vue-share-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Vue Bridge remotes and hosts that omit `vue` (and `vue-router` when used) from `shared` can load duplicate Vue runtimes and break reactivity or routing.

## So beheben Sie das Problem

Share `vue` (and `vue-router` when imported) as singletons, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/vue-share-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/integrations/practice/vue)
