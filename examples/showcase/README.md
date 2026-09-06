# One-rule CLI showcase

These setups are intentionally wrong so `mfdoctor check` / `mfdoctor federation`
/ `mfdoctor runtime` can demo **one rule (or a small combination) at a time**.
They are CLI fixtures, not bundler apps, and are not part of the green e2e path.

For per-bundler **build+MFDoctor** demos with visible findings, use
[`../standalone-findings`](../standalone-findings) (`vp run demo:standalone`).

Showcase fixtures prefer cases Module Federation plugins often allow through to
a build (or only warn about later). Rules that duplicate a hard plugin
failure—such as a missing `name`—stay in the catalog but are not demoed here.

## Config

| Directory                                     | Expected rule                           | Severity / note                                     |
| --------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `config/expose-key-invalid`                   | `config/expose-key-invalid`             | error                                               |
| `config/expose-path-missing`                  | `config/expose-path-missing`            | error                                               |
| `config/remote-entry-invalid`                 | `config/remote-entry-invalid`           | error                                               |
| `config/filename-invalid`                     | `config/filename-invalid`               | error                                               |
| `config/hashed-remote-filename`               | `config/hashed-remote-filename`         | warning (webpack/rspack `[contenthash]`)            |
| `config/share-scope-undeclared`               | `config/share-scope-undeclared`         | error                                               |
| `config/async-boundary-missing`               | `config/async-boundary-missing`         | error                                               |
| `config/async-boundary-missing-ok`            | _(none)_                                | async `import('./bootstrap')` (no RUNTIME-005)      |
| `config/remote-http-insecure`                 | `config/remote-http-insecure`           | warning                                             |
| `config/implementation-local`                 | _(none)_                                | local `implementation` does not fire                |
| `config/implementation-suspicious-suppressed` | _(none)_                                | `rules["config/implementation-suspicious"] = "off"` |
| `config/remote-localhost-in-production`       | `config/remote-localhost-in-production` | warning (CI mode)                                   |
| `config/remote-alias-prefix-collision`        | `config/remote-alias-prefix-collision`  | error                                               |
| `config/dts-output-dir-mismatch`              | `config/dts-output-dir-mismatch`        | warning                                             |
| `config/async-startup-rspack-version`         | `config/async-startup-rspack-version`   | warning (Rspack ≤ 1.7.4)                            |
| `config/rsbuild-mf-api-generation`            | `config/rsbuild-mf-api-generation`      | error                                               |
| `config/shared-externals-conflict`            | `config/shared-externals-conflict`      | warning                                             |

## Shared

| Directory                          | Expected rule                    | Severity / note                          |
| ---------------------------------- | -------------------------------- | ---------------------------------------- |
| `shared/eager-without-singleton`   | `shared/eager-without-singleton` | warning                                  |
| `shared/version-unsatisfied`       | `shared/version-unsatisfied`     | error                                    |
| `shared/singleton-risk`            | `shared/singleton-risk`          | warning                                  |
| `shared/singleton-risk-suppressed` | _(none)_                         | `rules["shared/singleton-risk"] = "off"` |
| `shared/unused`                    | `shared/unused`                  | warning                                  |
| `shared/unused-unresolved`         | `doctor/partial-analysis`        | no `shared/unused` (unresolved dynamics) |
| `shared/candidate`                 | `shared/candidate`               | info                                     |
| `shared/candidate-suppressed`      | _(none)_                         | `rules["shared/candidate"] = "off"`      |
| `shared/deep-import-bypass`        | `shared/deep-import-bypass`      | warning                                  |

## Reliability

| Directory                                   | Expected rule                               | Severity |
| ------------------------------------------- | ------------------------------------------- | -------- |
| `reliability/version-first-offline-remotes` | `reliability/version-first-offline-remotes` | warning  |
| `reliability/shared-import-false`           | `reliability/shared-import-false`           | warning  |

## Vite

CLI/config-only dialect fixtures (not full Vite apps). `vite/alias-share-bypass`
seeds `viteConfigFacts.resolveAliases` the way a plugin `configResolved` snapshot would.

| Directory                             | Expected rule                           | Severity |
| ------------------------------------- | --------------------------------------- | -------- |
| `vite/hashed-remote-filename`         | `vite/hashed-remote-filename`           | warning  |
| `vite/remotes-prefer-module`          | `vite/remotes-prefer-module`            | warning  |
| `vite/copied-webpack-options-on-vite` | `config/copied-webpack-options-on-vite` | warning  |
| `vite/alias-share-bypass`             | `vite/alias-share-bypass`               | warning  |

## Bridge

CLI/config-only Bridge fixtures (not full Bridge apps). React detection uses
`runtimePlugins` + `bridge.enableBridgeRouter`; Vue detection uses a source import
of `@module-federation/bridge-vue3`.

| Directory                   | Expected rule               | Severity |
| --------------------------- | --------------------------- | -------- |
| `bridge/export-app-missing` | `bridge/export-app-missing` | warning  |
| `bridge/vue-share-missing`  | `bridge/vue-share-missing`  | error    |

## Artifact

CLI/config-only artifact fixtures (not a bundler emit). Source scan of
`react-dom/server` on a web/client target is enough for
`artifact/react-dom-server-in-web`.

| Directory                          | Expected rule                      | Severity |
| ---------------------------------- | ---------------------------------- | -------- |
| `artifact/react-dom-server-in-web` | `artifact/react-dom-server-in-web` | error    |

## SSR

CLI/config-only dual-env fixtures. Vite `target: "node"` and Enhanced
`experiments.optimization.target: "node"` both normalize to node/SSR facts.
Omitting `@module-federation/node/runtimePlugin` is enough for
`ssr/node-runtime-plugin-missing`.

| Directory                         | Expected rule                     | Severity |
| --------------------------------- | --------------------------------- | -------- |
| `ssr/node-runtime-plugin-missing` | `ssr/node-runtime-plugin-missing` | error    |

## Runtime plugins

CLI/config-only runtime plugin contract fixtures. Local `runtimePlugins`
paths are inspected from source (CORS parity and factory shape).

| Directory                                   | Expected rule                               | Severity |
| ------------------------------------------- | ------------------------------------------- | -------- |
| `runtime-plugins/invalid-factory`           | `runtime-plugins/invalid-factory`           | warning  |
| `runtime-plugins/create-script-cors-parity` | `runtime-plugins/create-script-cors-parity` | warning  |

## Federation

Committed `.project.json` facts for `mfdoctor federation`:

| Directory                            | Expected rule                        | Severity                                                                                                   |
| ------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `federation/version-conflict`        | `federation/version-conflict`        | error                                                                                                      |
| `federation/share-scope-mismatch`    | `federation/share-scope-mismatch`    | error                                                                                                      |
| `federation/share-strategy-mismatch` | `federation/share-strategy-mismatch` | warning (omitted host `shareStrategy` vs remote `loaded-first`; omitted is not treated as `version-first`) |
| `federation/circular-remote-graph`   | `federation/circular-remote-graph`   | warning                                                                                                    |
| `federation/singleton-mismatch`      | `shared/singleton-mismatch`          | warning                                                                                                    |
| `federation/name-conflict`           | `federation/name-conflict`           | error                                                                                                      |
| `federation/missing-provider`        | `federation/missing-provider`        | error                                                                                                      |
| `federation/host-gaps`               | `federation/host-gaps`               | warning                                                                                                    |
| `federation/ghost-shares`            | `federation/ghost-shares`            | info                                                                                                       |

## Runtime

| Directory                 | Expected                  | Exit |
| ------------------------- | ------------------------- | ---- |
| `runtime/green`           | no findings               | 0    |
| `runtime/shared-mismatch` | `runtime/shared-mismatch` | 1    |

```bash
vp run --filter . build
vp run demo:showcase
# or one at a time:
node dist/cli.js check examples/showcase/config/expose-key-invalid --ci --format terminal
node dist/cli.js federation "examples/showcase/federation/version-conflict/*.project.json" --format terminal
node dist/cli.js runtime examples/showcase/runtime/green/trace.json "examples/showcase/runtime/green/*.project.json" --format terminal
```

For a healthy multi-bundler app, use `examples/mixed-federation`.
For nested multi-bundler orchestration, use `examples/nested-federation`.
For a red multi-bundler combination, use `examples/mixed-federation-issues`.
For per-bundler standalone build findings, use `examples/standalone-findings`.
