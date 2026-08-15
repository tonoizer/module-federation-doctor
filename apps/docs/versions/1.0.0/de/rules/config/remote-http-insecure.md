<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/remote-http-insecure`

- Kategorie: **security**
- Standardschweregrad: **warning**

## Problem

Remote code fetched over plain HTTP can be changed in transit.

## So beheben Sie das Problem

Serve non-local remotes over HTTPS and keep HTTP only for local development.

Suppress or retarget with `rules["config/remote-http-insecure"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/remotes.html)
