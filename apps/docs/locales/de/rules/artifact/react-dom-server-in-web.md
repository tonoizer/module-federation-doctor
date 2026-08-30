<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `artifact/react-dom-server-in-web`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

react-dom/server (and related server entries) in a web/client Module Federation bundle crash or mis-target the browser runtime — a common MF/SSR boundary failure.

## So beheben Sie das Problem

Keep `react-dom/server` (and `react-dom/server.*`) on the SSR/server build only. Use a client entry such as `react-dom/client` for web remotes/hosts, or mark the target with `ssrMode: "node"` / `experiments.target: "node"` when the artifact is server-only. Set `rules["artifact/react-dom-server-in-web"]` to `"off"` when intentional.

Suppress or retarget with `rules["artifact/react-dom-server-in-web"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://react.dev/reference/react-dom/server)
- [Official source](https://module-federation.io/guide/framework/react)
