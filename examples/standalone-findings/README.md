# Per-bundler standalone findings

Four **standalone** micro-frontend cells (one per supported bundler). Each runs
`vp run build` with the matching MFDoctor adapter and emits intentional findings in
`.mf/doctor/report.json`. They are not nested and are not part of Playwright e2e.

For one-rule CLI fixtures, see [`../showcase`](../showcase) (one-rule catalog).
For a flat multi-bundler red combo, see [`../mixed-federation-issues`](../mixed-federation-issues).
For nested multi-bundler orchestration, see [`../nested-federation`](../nested-federation).

| Cell       | Bundler | Expected rule IDs                                                                                                |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `vite/`    | Vite    | `config/remote-http-insecure`, `config/remote-manifest-recommended`, `reliability/version-first-offline-remotes` |
| `webpack/` | Webpack | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |
| `rspack/`  | Rspack  | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |
| `rsbuild/` | Rsbuild | `shared/eager-without-singleton`, `shared/singleton-risk`                                                        |

```bash
vp run demo:standalone
# or one cell:
vp run --filter @mfdoctor-standalone/vite build
```
