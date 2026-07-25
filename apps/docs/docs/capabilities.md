# Capability matrix

| Capability           | Vite                    | Rspack            | Rsbuild               |
| -------------------- | ----------------------- | ----------------- | --------------------- |
| Explicit MF config   | Yes                     | Yes               | Yes                   |
| Static imports       | Yes                     | Yes               | Yes                   |
| Manifest and stats   | Yes                     | Yes               | Yes                   |
| Emitted assets       | Rollup-compatible hooks | Compilation hooks | Rspack when available |
| Cross-project checks | Yes                     | Yes               | Yes                   |

Rules consult recorded capabilities. Missing optional input creates
`doctor/partial-analysis` instead of pretending full analysis happened.
