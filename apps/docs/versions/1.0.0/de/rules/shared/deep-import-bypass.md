<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `shared/deep-import-bypass`

- Kategorie: **performance**
- Standardschweregrad: **warning**

## Problem

Subpath imports bypass Module Federation shared-scope negotiation when only the root package is declared in `shared`, so each microfrontend may bundle its own copy.

## So beheben Sie das Problem

Prefer root imports (for example `import { cloneDeep } from "lodash"`), or add the exact subpath keys to `shared`. For React and React DOM subpaths, use `shared/prefix-share-recommended`. Suppress intentional cases with `rules["shared/deep-import-bypass"]` or `deepImportAllowlist`.

Suppress or retarget with `rules["shared/deep-import-bypass"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/shared.html)
