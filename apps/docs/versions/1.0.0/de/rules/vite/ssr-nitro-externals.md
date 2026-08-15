<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/ssr-nitro-externals`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Shared React (or react-dom) can conflict with Nitro/SSR externals and `ssrEntryLoader` when the server expects a different module instance.

## So beheben Sie das Problem

Align `shared` React with `ssrExternals` / `ssrEntryLoader` for the SSR runtime, or document an intentional dual-instance path.

Suppress or retarget with `rules["vite/ssr-nitro-externals"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
