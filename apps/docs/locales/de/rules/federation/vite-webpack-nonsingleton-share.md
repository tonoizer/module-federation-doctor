<!-- mfdoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche mfdoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# `federation/vite-webpack-nonsingleton-share`

- Kategorie: **correctness**
- Standardschweregrad: **error**

## Problem

Since `@module-federation/vite` 1.22.0, a webpack/rspack/enhanced peer that shares the same package as a non-singleton can mark that share loaded without the `lib` a Vite remote's production `loadShare` wrapper expects, so container init crashes with RUNTIME-015 on every reload after the first load.

## So beheben Sie das Problem

Upgrade `@module-federation/vite` to >=1.23.4 so Vite remotes seed unbridged webpack non-singleton shares (https://github.com/module-federation/vite/issues/1429).

Suppress or retarget with `rules["federation/vite-webpack-nonsingleton-share"]` set to `"off"` or a severity, see [Suppressions and allowlists](../../suppressions.md).

## Quellen

- [Official source](https://github.com/module-federation/vite/issues/1429)
- [Official source](https://github.com/module-federation/vite/pull/1431)
- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://github.com/module-federation/vite)
