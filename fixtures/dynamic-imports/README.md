# Dynamic-import fixtures

Offline source snippets used by unit/integration tests for MFDOCTOR-105.

| File                        | Pattern                                            |
| --------------------------- | -------------------------------------------------- |
| `dynamic-import-package.ts` | `import("lodash")` shared package                  |
| `dynamic-import-local.ts`   | `import("./Widget")` local expose path             |
| `dynamic-import-remote.ts`  | `import("shop/Card")` configured remote            |
| `load-remote.ts`            | `loadRemote("shop/Card")`                          |
| `load-share.ts`             | `loadShare("react")`                               |
| `register-remotes.ts`       | `registerRemotes([{ name: "checkout", … }])`       |
| `unresolved-import.ts`      | `import(moduleId)` → partial analysis              |
| `unresolved-load-share.ts`  | `loadShare(name)` → suppress false `shared/unused` |

Runtime trace reuse: `../runtime-traces/healthy.json` for opt-in shared hints.
