<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/rsbuild-mf-api-generation`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Rsbuild Module Federation 1.5 (`moduleFederation.options`) and `@module-federation/rsbuild-plugin` v2 use different option surfaces. Copied or nested keys are ignored or crash during generate/runtime instead of emitting the expected MF API, types, or manifest.

## So beheben Sie das Problem

Use `@module-federation/rsbuild-plugin` with a flat `pluginModuleFederation({ ... })` config for MF 2.0 generation options (`dts`, `manifest`, `getPublicPath`, …). Keep Rsbuild `moduleFederation.options` for MF 1.5 only. Pass `target` / `environment` / `ssrDir` as the plugin second argument, never under a nested `options` bag.

Suppress or retarget with `rules["config/rsbuild-mf-api-generation"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/integrations/build-tool/rsbuild)
- [Official source](https://rsbuild.rs/guide/advanced/module-federation)
- [Official source](https://module-federation.io/configure/index.html)
