# `federation/vite-webpack-nonsingleton-share`

- Category: **correctness**
- Default severity: **error**

## Issue

Since `@module-federation/vite` 1.22.0, a webpack/rspack/enhanced peer that shares the same package as a non-singleton can mark that share loaded without the `lib` a Vite remote's production `loadShare` wrapper expects, so container init crashes with RUNTIME-015 on every reload after the first load.

## How to fix it

Upgrade `@module-federation/vite` to >=1.23.4 so Vite remotes seed unbridged webpack non-singleton shares (https://github.com/module-federation/vite/issues/1429).

Suppress or retarget with `rules["federation/vite-webpack-nonsingleton-share"]` set to `"off"` or a severity, see [Suppressions and allowlists](../../suppressions.md).

## Sources

- [Official source](https://github.com/module-federation/vite/issues/1429)
- [Official source](https://github.com/module-federation/vite/pull/1431)
- [Official source](https://module-federation.io/configure/shared.html)
- [Official source](https://github.com/module-federation/vite)
