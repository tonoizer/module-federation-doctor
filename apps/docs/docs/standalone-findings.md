# Standalone per-bundler findings

`examples/standalone-findings` has four **standalone** cells — one per supported
bundler — that run a real `pnpm build` with the matching Doctor adapter and emit
intentional findings.

They are not nested. Nested multi-app orchestration lives in
[`examples/nested-federation`](https://github.com/tonoizer/module-federation-doctor/tree/main/examples/nested-federation)
([nested docs](./nested-example.md)).

| Cell       | Bundler | Expected rule IDs                                                                                                |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `vite/`    | Vite    | `config/remote-http-insecure`, `config/remote-manifest-recommended`, `reliability/version-first-offline-remotes` |
| `webpack/` | Webpack | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |
| `rspack/`  | Rspack  | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |
| `rsbuild/` | Rsbuild | `shared/eager-without-singleton`, `shared/singleton-risk`                                                        |

```bash
pnpm demo:standalone
# or one cell:
pnpm --filter @mfdoctor-standalone/vite build
pnpm --filter @mfdoctor-standalone/webpack build
pnpm --filter @mfdoctor-standalone/rspack build
pnpm --filter @mfdoctor-standalone/rsbuild build
```

Each cell sets `failOn: "never"` so the build still completes and writes
`.mf/doctor/report.json`. The demo script asserts the expected rule IDs are
present.

For one-rule CLI fixtures, see the [one-rule showcase](./showcase.md).
For a flat multi-bundler red combo, see [mixed federation issues](./mixed-issues-example.md).
