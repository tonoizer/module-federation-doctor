<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/ssr-instanceid-hydration`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

Without a stable `bridge.instanceId`, SSR Bridge hydration registries can collide across requests.

## So beheben Sie das Problem

Set `bridge.instanceId` for SSR builds, use `ssrMode: "browser-only"` when not SSR, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/ssr-instanceid-hydration"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
