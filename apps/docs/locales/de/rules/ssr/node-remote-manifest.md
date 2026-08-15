<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `ssr/node-remote-manifest`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Node/SSR consumers that load the browser `mf-manifest.json` miss the server remote graph and can fail to resolve remotes during SSR.

## So beheben Sie das Problem

Point node/SSR remotes at `/ssr/mf-manifest.json` (or another env-specific path). Set `ssrMode: "browser-only"` when the build is not SSR, or turn the rule `"off"`.

Suppress or retarget with `rules["ssr/node-remote-manifest"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/guide/basic/manifest-snapshot.html)
- [Official source](https://module-federation.io/integrations/build-tool/rsbuild)
