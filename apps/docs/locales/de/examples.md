<!-- MFDoctor locale: de. Technische Bezeichner, CLI-Flags, Regel-IDs, Links und Codebeispiele bleiben byte-kompatibel mit dem kanonischen englischen Vertrag. -->

> Dies ist die deutsche MFDoctor-Dokumentation. Technische Bezeichner, CLI-Flags, Regel-IDs und Codebeispiele bleiben unverändert, damit die Inhalte zwischen den Sprachen vollständig kompatibel bleiben. Verwenden Sie den Sprachumschalter für die kanonische englische Fassung.

# Examples

Runnable fixtures that show how MFDoctor behaves on real Module Federation
graphs. Start here, then open a specific page for commands and expected
findings.

| Example                            | What it shows                                         | Docs                                                 |
| ---------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `examples/mixed-federation`        | Green Vite + Rspack + Rsbuild host/remotes (e2e path) | [Mixed federation](./mixed-example.md)               |
| `examples/nested-federation`       | Nested Vite host → Vite/Rsbuild → Rspack/Webpack      | [Nested federation](./nested-example.md)             |
| `examples/mixed-federation-issues` | Same flat topology, intentional red findings          | [Mixed federation issues](./mixed-issues-example.md) |
| `examples/standalone-findings`     | Per-bundler Vite/Webpack/Rspack/Rsbuild build demos   | [Standalone findings](./standalone-findings.md)      |
| `examples/showcase`                | One-rule CLI demos by category                        | [One-rule showcase](./showcase.md)                   |
| `examples/compatibility/webpack`   | Webpack adapter smoke for the compatibility matrix    | [Compatibility](./compatibility.md)                  |

Root helpers: `vp run demo:showcase`, `vp run demo:standalone`, `vp run demo:mixed-issues`,
`vp run demo:nested`, and `vp run demo:examples` (showcase + standalone + mixed-issues +
nested).
