# Configuration audit

This page separates common Module Federation config from Vite-only controls.
Use it as a review checklist even when a rule does not yet automate the check.

## Common and Core/Rspack/Rsbuild options

| Option                         | Main risk                                         | Practical fix                                                  |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------- |
| `name`                         | Runtime/global collision                          | Use one stable unique name per container                       |
| `filename`                     | Missing or unsafe remote entry                    | Use a relative JavaScript filename and verify emission         |
| `library` + `remoteType`       | Producer/consumer format mismatch                 | Align global, module, CommonJS, or script contracts            |
| `remotes`                      | Bad URL, alias, scope, or offline startup         | Prefer HTTPS manifest URLs; test failure recovery              |
| `shareScope`                   | Isolated pools cannot reuse packages              | Align top-level, remote, and item scopes                       |
| `exposes`                      | Bad public key or missing source                  | Use `./Name` keys and exact paths                              |
| `shared`                       | Duplicate frameworks or unsatisfied versions      | Align singleton, versions, scope, strictness, and fallback     |
| `runtimePlugins`               | Missing plugin or unsafe recovery                 | Resolve every plugin and test each hook path                   |
| `getPublicPath`                | Dynamic-code and asset-base risk                  | Keep the stringified function small, static, and reviewed      |
| `implementation`               | Runtime/plugin version skew                       | Resolve a compatible `runtime-tools` implementation            |
| `dts`                          | Missing/stale consumer contracts                  | Generate types in CI and choose an explicit abort policy       |
| `dev`                          | Reload/type-HMR behavior differs from build       | Document disabled reload features and test remote HMR          |
| `manifest`                     | Missing runtime metadata or incomplete asset data | Emit it for releases; keep producer asset analysis enabled     |
| `shareStrategy`                | Startup cost vs late remote failure               | Pick `version-first` or `loaded-first` intentionally           |
| `experiments.asyncStartup`     | Entry exports become async                        | Ensure direct/UMD consumers await the Promise                  |
| `externalRuntime` pair         | Hard load-order dependency                        | One pure provider; externalize only downstream browser remotes |
| snapshot/remote/shared removal | Tree-shaken capability still used                 | Never disable a configured capability                          |
| shared tree shaking            | Incomplete deployment union                       | Publish the merged secondary artifact and update snapshots     |
| `injectTreeShakingUsedExports` | Conflicts with `server-calc`                      | Disable it for deployment-calculated exports                   |
| `treeShakingDir`               | No known fallback artifact location               | Configure and publish the directory                            |
| shared tree-shaking plugins    | Secondary build misses original transforms        | Package only the needed build plugins and pin versions         |

Official option pages:
[overview](https://module-federation.io/configure/index.html),
[shared](https://module-federation.io/configure/shared.html),
[DTS](https://module-federation.io/configure/dts.html),
[dev](https://module-federation.io/configure/dev.html),
[manifest](https://module-federation.io/configure/manifest.html),
and
[experiments](https://module-federation.io/configure/experiments.html).

## Vite-only options

| Option                   | Main risk                                    | Practical fix                                                 |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------- |
| `publicPath`             | Browser assets resolve from the wrong origin | Compare config with emitted manifest metadata                 |
| `bundleAllCSS`           | Every expose receives every stylesheet       | Keep false unless the global style contract is deliberate     |
| `ignoreOrigin`           | Proxy entry origin behavior changes          | Use only with a tested deployment base                        |
| `virtualModuleDir`       | Invalid or colliding virtual module folder   | Use one simple directory name without slashes                 |
| `hostInitInjectLocation` | HTML-less/SSR app misses init                | Use `entry` when no usable HTML transform exists              |
| parser timeouts          | Partial dependency discovery                 | Use an idle timeout for large active builds                   |
| `varFilename`            | Sync script contract differs from ESM entry  | Load it through a synchronous script and test the global name |
| `target`                 | Browser and Node output rules mix            | Set the real execution environment                            |
| `ssrExternals`           | Server-only package gets bundled             | Externalize explicit Node-only dependencies                   |
| direct capability flags  | Useful runtime feature is removed            | Match flags to actual remotes/shared/snapshot use             |

Vite source:
[option normalizer](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/src/utils/normalizeModuleFederationOptions.ts)
and
[plugin integration](https://github.com/module-federation/vite/blob/321d7db8a4b2a1764b3a7cdc16246222d97231ac/src/index.ts).

## Output verification

Config review is not enough. In CI, confirm:

1. the configured remote entry exists;
2. manifest name and entry metadata match config;
3. every expose appears and has assets;
4. manifest shared versions match the lockfile install;
5. type metadata and archives exist when DTS is enabled;
6. every application's `project.json` passes federation-wide analysis.
