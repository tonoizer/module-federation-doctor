# Standalone per-bundler findings

`examples/standalone-findings` has five **standalone** cells that run a real
`vp run build` with the matching MFDoctor adapter and emit intentional findings.
Vite, Webpack, Rspack, and Rsbuild are first-class. `modern/` is a documented
**partial** stub using the same `modifyBundlerChain` afterEmit path as
[`examples/compatibility/modern`](https://github.com/tonoizer/module-federation-doctor/tree/main/examples/compatibility/modern)
(Rspack-under-the-hood; not `@modern-js/app-tools`).

They are not nested. Nested multi-app orchestration lives in
[`examples/nested-federation`](https://github.com/tonoizer/module-federation-doctor/tree/main/examples/nested-federation)
([nested docs](./nested-example.md)).

| Cell       | Bundler                 | Expected rule IDs                                                                                                |
| ---------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `vite/`    | Vite                    | `config/remote-http-insecure`, `config/remote-manifest-recommended`, `reliability/version-first-offline-remotes` |
| `webpack/` | Webpack                 | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |
| `rspack/`  | Rspack                  | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |
| `rsbuild/` | Rsbuild                 | `shared/eager-without-singleton`, `shared/singleton-risk`                                                        |
| `modern/`  | Modern.js (**partial**) | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |

```bash
vp run demo:standalone
# or one cell:
vp run --filter @mfdoctor-standalone/vite build
vp run --filter @mfdoctor-standalone/webpack build
vp run --filter @mfdoctor-standalone/rspack build
vp run --filter @mfdoctor-standalone/rsbuild build
vp run --filter @mfdoctor-standalone/modern build
```

Each cell sets `failOn: "never"` so the build still completes and writes
`.mf/doctor/report.json`. The demo script asserts the expected rule IDs are
present. The Modern cell also asserts `project.json` records `bundler: "modern"`.
It does **not** change the compatibility matrix status — Modern.js stays
**partial** until a real `@modern-js/app-tools` build lands ([#130](https://github.com/tonoizer/module-federation-doctor/issues/130)).

For one-rule CLI fixtures, see the [one-rule showcase](./showcase.md).
For a flat multi-bundler red combo, see [mixed federation issues](./mixed-issues-example.md).
