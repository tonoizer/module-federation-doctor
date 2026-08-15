<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `vite/var-filename-interop`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

`varFilename` emits an additional global-format remote entry so var hosts (webpack/rspack) can load this Vite producer.

## So beheben Sie das Problem

Keep `varFilename` when serving webpack/rspack var hosts. Prefer `type: 'module'` remotes when this app is a Vite consumer talking to Vite producers.

Suppress or retarget with `rules["vite/var-filename-interop"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite)
