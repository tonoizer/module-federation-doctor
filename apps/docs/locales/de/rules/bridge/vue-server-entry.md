<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/vue-server-entry`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Browser-only Vue Bridge entries in node/SSR builds miss the server/hydration contract and can leak client-only Bridge code.

## So beheben Sie das Problem

Import `@module-federation/bridge-vue3/server` (or the documented SSR entry). Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["bridge/vue-server-entry"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/integrations/practice/vue)
