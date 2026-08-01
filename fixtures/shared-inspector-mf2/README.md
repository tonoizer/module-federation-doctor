# shared-inspector-mf2

Minimal **MF2 shared-array** evidence shaped like `@mf-toolkit/shared-inspector` stress fixtures.

| Path                                | What it proves                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `shell.mf-manifest.json`            | Host MF2 manifest with `shared: [...]` array (**primary #127 input**)                                                                    |
| `checkout.mf-manifest.json`         | Remote MF2 manifest with local shared + expose                                                                                           |
| `inherited-shared.mf-manifest.json` | Inherited `from: "host"` entry mixed with local shared (filter signal)                                                                   |
| `.mf/doctor/project.json`           | Golden Doctor project facts with **normalized** `artifacts.manifest` (Doctor drops MF2 `from`; load the standalone JSON for inheritance) |

No toolkit packages are vendored; JSON shapes only for offline #127 alignment.
