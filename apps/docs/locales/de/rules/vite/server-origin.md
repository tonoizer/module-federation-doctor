<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/server-origin`

- Kategorie: **reliability**
- Standardschweregrad: **info**

## Problem

Without `server.origin`, remote consumers may resolve assets against the wrong public origin in development.

## So beheben Sie das Problem

Set Vite `server.origin` to the URL remotes should publish for consumers. MFDoctor recommends `http://localhost:<server.port>` (default port 5173); configure `rules["vite/server-origin"].recommendedOrigin` or turn off `requireServerOrigin` when your topology differs.

Suppress or retarget with `rules["vite/server-origin"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
