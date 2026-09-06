<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/async-startup-rspack-version`

- Kategorie: **correctness**
- Standardschweregrad: **warning**

## Problem

`experiments.asyncStartup` is a no-op (or a silent break) on Rspack versions that do not implement it. Enabling the flag then skips the manual async-boundary check while the bundler still starts synchronously.

## So beheben Sie das Problem

Upgrade `@rspack/core` to a version greater than 1.7.4, or disable `experiments.asyncStartup` until the bundler can honor it.

Suppress or retarget with `rules["config/async-startup-rspack-version"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/experiments.html)
- [Official source](https://module-federation.io/blog/hoisted-runtime.md)
- [Official source](https://github.com/web-infra-dev/rspack/pull/11899)
