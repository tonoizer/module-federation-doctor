<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/host-init-inject-ssr`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

SSR and HTML-less frameworks need host init injected into the entry, not the HTML document, or federation bootstrap never runs on the server.

## So beheben Sie das Problem

Set `hostInitInjectLocation: 'entry'` for SSR / Nitro / Nuxt-style apps.

Suppress or retarget with `rules["vite/host-init-inject-ssr"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
