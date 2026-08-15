<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `ssr/node-runtime-plugin-missing`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Without `@module-federation/node/runtimePlugin`, Node Federation hosts cannot load remotes with the server runtime contract.

## So beheben Sie das Problem

Add `@module-federation/node/runtimePlugin` to `runtimePlugins`. Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["ssr/node-runtime-plugin-missing"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/plugin/plugins/)
- [Official source](https://module-federation.io/blog/node)
