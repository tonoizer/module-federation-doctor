# Examples

Runnable fixtures that show how Doctor behaves on real Module Federation
graphs. Start here, then open a specific page for commands and expected
findings.

| Example                            | What it shows                                              | Docs                                                 |
| ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `examples/mixed-federation`        | Green Vite + Rspack + Rsbuild host/remotes (e2e path)      | [Mixed federation](./mixed-example.md)               |
| `examples/nested-federation`       | Nested Vite host → Vite/Rsbuild → Rspack/Webpack           | [Nested federation](./nested-example.md)             |
| `examples/mixed-federation-issues` | Same flat topology, intentional red findings               | [Mixed federation issues](./mixed-issues-example.md) |
| `examples/standalone-findings`     | Per-bundler Vite/Webpack/Rspack/Rsbuild build demos        | [Standalone findings](./standalone-findings.md)      |
| `examples/showcase`                | One-rule CLI demos by category                             | [One-rule showcase](./showcase.md)                   |
| `examples/compatibility/webpack`   | Webpack adapter smoke for the compatibility matrix         | [Compatibility](./compatibility.md)                  |

Root helpers: `pnpm demo:showcase`, `pnpm demo:standalone`, `pnpm demo:mixed-issues`,
`pnpm demo:nested`, and `pnpm demo:examples` (showcase + standalone + mixed-issues +
nested).
