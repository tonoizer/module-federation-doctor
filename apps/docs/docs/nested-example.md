# Nested federation example

A multi-level Module Federation graph across bundlers:

| App                 | Bundler | Role                                  |
| ------------------- | ------- | ------------------------------------- |
| Host                | Vite    | Loads Vite + Rsbuild remotes          |
| Intermediate remote | Vite    | Exposes a panel; loads an Rspack leaf |
| Intermediate remote | Rsbuild | Exposes a card; loads a Webpack leaf  |
| Leaf                | Rspack  | Exposes a card                        |
| Leaf                | Webpack | Exposes a widget                      |

Each app wires the MFDoctor adapter for its bundler. Build the suite, then gate
cross-app facts:

```bash
pnpm demo:nested
# or:
pnpm test:nested
```

This path stays green. Consumers that use `remoteEntry.js` turn off
`config/remote-manifest-recommended` (and Vite consumers also turn off
`reliability/version-first-offline-remotes`) with comments — same suppression
pattern as the [mixed example](./mixed-example.md).

For intentional red findings, use [mixed issues](./mixed-issues-example.md) or
the [one-rule showcase](./showcase.md). Per-bundler build+MFDoctor demos:
[standalone findings](./standalone-findings.md).
