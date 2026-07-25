# Examples

Runnable fixtures that show how Doctor behaves on real Module Federation
graphs. Start here, then open a specific page for commands and expected
findings.

| Example                            | What it shows                                         | Docs                                                 |
| ---------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `examples/mixed-federation`        | Green Vite + Rspack + Rsbuild host/remotes (e2e path) | [Mixed federation](./mixed-example.md)               |
| `examples/mixed-federation-issues` | Same topology, intentional red findings               | [Mixed federation issues](./mixed-issues-example.md) |
| `examples/showcase`                | One-rule CLI demos by category                        | [Finding showcase](./showcase.md)                    |
| `examples/compatibility/webpack`   | Webpack adapter smoke for the compatibility matrix    | [Compatibility](./compatibility.md)                  |

## Planned demos

These land with separate issues; links here are stubs until the examples ship:

| Planned                       | Issue                                                                                  | Intent                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Nested multi-bundler showcase | [#47](https://github.com/tonoizer/module-federation-doctor/issues/47) (`MFDOCTOR-119`) | Host → Vite/Rsbuild remotes → nested Rspack/Webpack producers |
| Per-bundler standalone demos  | [#48](https://github.com/tonoizer/module-federation-doctor/issues/48) (`MFDOCTOR-120`) | Vite / Webpack / Rspack / Rsbuild cells with visible findings |

Root helpers: `pnpm demo:showcase`, `pnpm demo:mixed-issues`, and
`pnpm demo:examples` (showcase + mixed-issues).
