<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/split-chunks-mf-runtime`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

User cacheGroups that target mf-* / remoteEntry / shared-runtime chunks can steal Module Federation runtime and shared ownership, breaking init order or duplicate-share isolation. This is an advisory for observed public splitChunks only; MFDoctor does not nag every project to set chunks: "async".

## So beheben Sie das Problem

Exclude federation runtime chunks from cacheGroups (name, test, and filename). Leave MF-owned remoteEntry and shared-runtime chunks to the federation plugin, or allowlist a proven layout with `allowSplitChunks: true`.

Suppress or retarget with `rules["config/split-chunks-mf-runtime"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://webpack.js.org/plugins/split-chunks-plugin/)
- [Official source](https://rspack.rs/config/optimization#optimizationsplitchunks)
- [Official source](https://rsbuild.rs/config/performance/chunk-split)
