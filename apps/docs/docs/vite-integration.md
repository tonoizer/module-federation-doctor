# Vite integration notes

The Vite plugin is not a thin copy of the Rspack plugin. Doctor keeps its
Vite-only facts under the `vite` section of `project.json`.

## Vite-only options

| Option                          | Risk or opportunity                                 | Doctor guidance                         |
| ------------------------------- | --------------------------------------------------- | --------------------------------------- |
| `publicPath`                    | Wrong base breaks remote chunks and CSS             | Compare with manifest output            |
| `bundleAllCSS`                  | Full CSS set can repeat for every expose            | Warn for multi-expose producers         |
| `hostInitInjectLocation`        | HTML and entry injection serve different app shapes | Record for support evidence             |
| `moduleParseTimeout`            | Fixed timer can end a busy large parse              | Prefer idle timeout                     |
| `moduleParseIdleTimeout`        | Resets while modules are active                     | Better for large builds                 |
| `varFilename`                   | Adds a synchronous global-format entry              | Verify filename and deployment          |
| `target` / `ssrExternals`       | Changes server remote output                        | Keep SSR and browser contracts separate |
| `disableRemote/shared/snapshot` | Removes runtime capabilities                        | Reject config that still uses them      |

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
