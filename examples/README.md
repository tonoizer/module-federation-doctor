# Examples

Four stories live here. Use the flat green path for healthy e2e, nested for
multi-level multi-bundler orchestration, the red path for intentional
conflicts, and the showcase for one-rule demos.

| Suite                                                  | Intent                                                      | Command                                 |
| ------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------- |
| [`mixed-federation`](./mixed-federation)               | Healthy Vite + Rspack + Rsbuild e2e                         | `pnpm test:examples` / `pnpm test:e2e`  |
| [`nested-federation`](./nested-federation)             | Nested Vite host → Vite/Rsbuild → Rspack/Webpack            | `pnpm test:nested` / `pnpm demo:nested` |
| [`mixed-federation-issues`](./mixed-federation-issues) | Same flat topology, intentional shared/federation conflicts | `pnpm demo:mixed-issues`                |
| [`showcase`](./showcase)                               | Themed one-finding (or small combination) demos             | `pnpm demo:showcase`                    |

From the repo root:

```bash
pnpm build
pnpm demo:showcase
pnpm demo:mixed-issues
pnpm demo:nested
```

From this folder (via [`package.json`](./package.json)):

```bash
pnpm --dir examples demo              # showcase + mixed-issues
pnpm --dir examples demo:showcase
pnpm --dir examples demo:mixed-issues
pnpm --dir examples demo:nested
pnpm --dir examples build:green       # build healthy mixed-federation
pnpm --dir examples test:e2e          # Playwright green path
```

Or with the workspace filter:

```bash
pnpm --filter @mfdoctor-example/demos demo
```
