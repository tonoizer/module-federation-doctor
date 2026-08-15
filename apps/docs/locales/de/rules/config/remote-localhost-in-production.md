<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/remote-localhost-in-production`

- Kategorie: **reliability**
- Standardschweregrad: **warning**

## Problem

Localhost remotes in CI/production builds cannot resolve on other machines and break deployments.

## So beheben Sie das Problem

Point remotes at deployed HTTPS (or manifest) URLs for CI and production builds.

Suppress or retarget with `rules["config/remote-localhost-in-production"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/remotes.html)
