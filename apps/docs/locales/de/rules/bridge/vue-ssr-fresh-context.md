<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/vue-ssr-fresh-context`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Reusing one Vue app/router/store across SSR requests leaks request state between users.

## So beheben Sie das Problem

Create per-request app/router/store factories (or use Bridge SSR hydration helpers). Set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["bridge/vue-ssr-fresh-context"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/integrations/practice/vue)
