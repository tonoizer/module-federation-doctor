# Examples

Five stories live here. Use the flat green path for healthy e2e, nested for
multi-level multi-bundler orchestration, standalone cells for per-bundler
build+Doctor findings, the red path for intentional conflicts, and the showcase
for one-rule demos.

| Suite                                                  | Intent                                                         | Command                                 |
| ------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------- |
| [`mixed-federation`](./mixed-federation)               | Healthy Vite + Rspack + Rsbuild e2e                            | `pnpm test:examples` / `pnpm test:e2e`  |
| [`nested-federation`](./nested-federation)             | Nested Vite host → Vite/Rsbuild → Rspack/Webpack               | `pnpm test:nested` / `pnpm demo:nested` |
| [`standalone-findings`](./standalone-findings)         | Per-bundler standalone cells with visible Doctor findings      | `pnpm demo:standalone`                  |
| [`mixed-federation-issues`](./mixed-federation-issues) | Same flat topology, intentional shared/federation conflicts    | `pnpm demo:mixed-issues`                |
| [`showcase`](./showcase)                               | One-rule CLI fixtures (config / shared / federation / runtime) | `pnpm demo:showcase`                    |
| [`compatibility/webpack`](./compatibility/webpack)     | Webpack smoke for the compatibility matrix                     | compatibility workflow                  |

From the repo root:

```bash
pnpm build
pnpm demo:showcase
pnpm demo:standalone
pnpm demo:mixed-issues
pnpm demo:nested
```

From this folder (via [`package.json`](./package.json)):

```bash
pnpm --dir examples demo              # showcase + standalone + mixed-issues + nested
pnpm --dir examples demo:showcase
pnpm --dir examples demo:standalone
pnpm --dir examples demo:mixed-issues
pnpm --dir examples demo:nested
pnpm --dir examples build:green       # build healthy mixed-federation
pnpm --dir examples test:e2e          # Playwright green path
```

Or with the workspace filter:

```bash
pnpm --filter @mfdoctor-example/demos demo
```
