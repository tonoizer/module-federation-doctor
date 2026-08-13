# Vite integration notes

The Vite plugin is not a thin copy of the Rspack plugin. Doctor keeps its
Vite-only facts under the `vite` section of `project.json`.

## Rolldown and Vite Plus

Module Federation on Rolldown-integrated Vite and Vite Plus uses the **same**
Doctor entry as classic Vite:

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
```

| Flavor                    | How Doctor detects it                                                           | Emit engine |
| ------------------------- | ------------------------------------------------------------------------------- | ----------- |
| Classic Vite              | Default when no strong Rolldown / Vite Plus markers                             | `rollup`    |
| `rolldown-vite` / Vite 8+ | Declared `rolldown-vite`, `vite→rolldown-vite` alias, or `meta.rolldownVersion` | `rolldown`  |
| Vite Plus                 | `vite-plus` / `@voidzero-dev/vite-plus-core` (including `vite` alias overrides) | `rolldown`  |

Bare `rolldown` in `package.json` is weak evidence only (common in monorepo
tooling roots) and does **not** reclassify classic Vite by itself.

Doctor records `bundler.lifecycle` (`flavor`, `engine`, `postEmitHook`,
`evidence`) on `project.json`. Emit analysis prefers **on-disk** `dist/**` /
`build/**` assets over the in-memory Rollup `bundle` object, because Rolldown
does not share that object across hooks. When Rolldown has not finished writing
on `writeBundle`, Doctor defers to `closeBundle`. If emit facts are still
missing, it leaves `capabilities.emittedAssets` false so
[`doctor/partial-analysis`](./rules/doctor/partial-analysis.md) reports the gap
honestly.

Direct Rolldown **without** `@module-federation/vite` is unsupported — Rolldown
dropped built-in Module Federation in favor of the Vite plugin.

## Vite-only options

| Option                                       | Risk or opportunity                                     | Doctor guidance                                                                                |
| -------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `publicPath`                                 | Wrong base breaks remote chunks and CSS                 | Compare with manifest output                                                                   |
| `bundleAllCSS`                               | Full CSS set can repeat for every expose                | Warn for multi-expose producers                                                                |
| `hostInitInjectLocation`                     | HTML and entry injection serve different app shapes     | SSR needs `entry` ([`vite/host-init-inject-ssr`](./rules/vite/host-init-inject-ssr.md))        |
| `moduleParseTimeout`                         | Fixed timer can end a busy large parse                  | Prefer idle timeout                                                                            |
| `moduleParseIdleTimeout`                     | Resets while modules are active                         | Better for large builds                                                                        |
| `varFilename`                                | Adds a synchronous global-format entry                  | Verify filename and deployment; intentional mixed-bundler escape hatch                         |
| `target` / `ssrExternals` / `ssrEntryLoader` | Changes server remote output / React instance ownership | Keep SSR contracts aligned ([`vite/ssr-nitro-externals`](./rules/vite/ssr-nitro-externals.md)) |
| `disableRemote/shared/snapshot`              | Removes runtime capabilities                            | Reject config that still uses them                                                             |

### Remotes typing

Vite string remotes and object remotes without `type` default to **`var`**. Doctor warns via
[`vite/remotes-prefer-module`](./rules/vite/remotes-prefer-module.md) unless you set explicit
`type: 'module'` (Vite↔Vite ESM), another explicit type such as `global` for webpack/rspack
remotes, or configure producer `varFilename` for var-host interop
([`vite/var-filename-interop`](./rules/vite/var-filename-interop.md)).

## Dialect fact matrix (config-only vs plugin-resolved)

| Check                                   | CLI config-only            | Plugin `configResolved`              |
| --------------------------------------- | -------------------------- | ------------------------------------ |
| Remotes typing / `varFilename`          | Yes                        | Yes                                  |
| `hostInitInjectLocation` / SSR          | Yes (MF options + deps)    | Yes (+ builds when `targetKind=ssr`) |
| `manualChunks` / `codeSplitting.groups` | Skip                       | Yes (`bundler.viteConfig`)           |
| Hashed `filename`                       | Yes                        | Yes                                  |
| `remoteHmr`                             | Yes when set on MF options | Yes                                  |
| `resolve.alias` ∩ shared                | Skip                       | Yes                                  |
| `server.origin`                         | Skip                       | Yes                                  |

The full current surface is in the official
[normalizer](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/src/utils/normalizeModuleFederationOptions.ts).

## Chunk ownership

The plugin replaces user `manualChunks` and `codeSplitting.groups` choices
where needed. This is intentional: federation bootstrap depends on isolated
runtime-init and `loadShare` chunks. A custom group can create an init-order
cycle.

Fix: move general chunk tuning outside the federation runtime graph. Do not
fight the plugin by reapplying manual chunks after it.

Source:
[Vite plugin config hook](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/src/index.ts).

## Manifest asset analysis

`manifest.disableAssetsAnalyze` is not the same as
`dev.disableAssetsAnalyze`. The manifest option can speed a development
consumer, but on a producer it omits shared/expose asset detail. The official
`mf` skill currently describes this under `dev`; Doctor follows the actual
plugin type and implementation.

Fix: keep full asset analysis for production producer manifests. If it is
disabled for local speed, do not use that manifest as release evidence.
