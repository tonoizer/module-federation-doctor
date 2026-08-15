<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `bridge/ssr-server-entry-leak`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Browser-only Bridge React entries must not load inside node/SSR builds; doing so leaks DOM-oriented Bridge code into the server bundle.

## So beheben Sie das Problem

Import the Bridge `/server` entry (or a node-safe path) for SSR/node targets. Override with `ssrMode: "browser-only"` when the build is not SSR, or set the rule to `"off"`.

Suppress or retarget with `rules["bridge/ssr-server-entry-leak"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/bridge/react-bridge)
