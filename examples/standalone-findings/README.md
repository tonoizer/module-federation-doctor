# Per-bundler standalone findings

Five **standalone** micro-frontend cells. Four cover first-class bundlers
(Vite/Webpack/Rspack/Rsbuild). `modern/` is a documented **partial** stub of the
same afterEmit path used by `examples/compatibility/modern` (Rspack-under-the-hood
via `modifyBundlerChain`). Each runs `vp run build` with the matching MFDoctor
adapter and emits intentional findings in `.mf/doctor/report.json`. They are not
nested and are not part of Playwright e2e.

For one-rule CLI fixtures, see [`../showcase`](../showcase) (one-rule catalog).
For a flat multi-bundler red combo, see [`../mixed-federation-issues`](../mixed-federation-issues).
For nested multi-bundler orchestration, see [`../nested-federation`](../nested-federation).

| Cell       | Bundler                 | Expected rule IDs                                                                                                |
| ---------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `vite/`    | Vite                    | `config/remote-http-insecure`, `config/remote-manifest-recommended`, `reliability/version-first-offline-remotes` |
| `webpack/` | Webpack                 | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |
| `rspack/`  | Rspack                  | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |
| `rsbuild/` | Rsbuild                 | `shared/eager-without-singleton`, `shared/singleton-risk`                                                        |
| `modern/`  | Modern.js (**partial**) | `shared/version-unsatisfied`, `shared/singleton-risk`                                                            |

The `modern/` cell does **not** upgrade Modern.js to first-class. It records
`bundler: "modern"` and typically also reports `doctor/partial-analysis`. A real
`@modern-js/app-tools` build is still required for a **supported** matrix claim
(#130).

```bash
vp run demo:standalone
# or one cell:
vp run --filter @mfdoctor-standalone/vite build
vp run --filter @mfdoctor-standalone/modern build
```
