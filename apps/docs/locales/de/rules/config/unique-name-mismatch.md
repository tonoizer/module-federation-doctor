<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `config/unique-name-mismatch`

- Kategorie: **reliability**
- Standardschweregrad: **info**

## Problem

Webpack/Rspack `output.uniqueName` namespaces the compiler runtime. When it disagrees with Module Federation `name` on the same compiler, chunk-loading globals and the container id can diverge. This stays info because uniqueName is often set equal on purpose, and a mismatch can be intentional. Multi-plugin compilers are skipped because uniqueName is compiler-scoped.

## So beheben Sie das Problem

Set `output.uniqueName` to the same value as Module Federation `name`. Omit uniqueName when you do not need an override.

Suppress or retarget with `rules["config/unique-name-mismatch"]` set to `"off"` or a severity — see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://module-federation.io/configure/name.html)
- [Official source](https://webpack.js.org/configuration/output/#outputuniquename)
- [Official source](https://rspack.rs/config/output#outputuniquename)
