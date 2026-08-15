<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/remote-manifest-recommended`

- Kategorie: **tooling**
- Standardschweregrad: **info**

## Problem

A direct remote entry lacks manifest-powered type hints, preloading data, and richer DevTools data. The `demo` policy only softens this recommendation for explicitly known-local bare/relative entries or loopback URLs during development; external, authenticated non-loopback, unknown, and CI remotes remain visible.

## So beheben Sie das Problem

Point consumers at `mf-manifest.json` when those capabilities are wanted.

Suppress or retarget with `rules["config/remote-manifest-recommended"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/remotes.html)
- [Official source](https://module-federation.io/configure/manifest.html)
