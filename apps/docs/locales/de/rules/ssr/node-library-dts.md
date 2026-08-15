<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `ssr/node-library-dts`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Node/SSR producers that keep ESM-style `library.type` or enabled `dts` diverge from the commonjs dual-env contract used by server remotes.

## So beheben Sie das Problem

Set `library: { type: "commonjs-module" }` (or another commonjs-like type) and `dts: false` on node/SSR producers. Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["ssr/node-library-dts"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/blog/node)
