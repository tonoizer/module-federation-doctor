# Examples

Three stories live here. Use the green path for healthy e2e, the red path for a
real multi-bundler report with conflicts, and the showcase for one-rule demos.

| Suite                                                  | Intent                                                 | Command                                |
| ------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------- |
| [`mixed-federation`](./mixed-federation)               | Healthy Vite + Rspack + Rsbuild e2e                    | `pnpm test:examples` / `pnpm test:e2e` |
| [`mixed-federation-issues`](./mixed-federation-issues) | Same topology, intentional shared/federation conflicts | `pnpm demo:mixed-issues`               |
| [`showcase`](./showcase)                               | Themed one-finding (or small combination) demos        | `pnpm demo:showcase`                   |

From the repo root:

```bash
pnpm build
pnpm demo:showcase
pnpm demo:mixed-issues
```

From this folder (via [`package.json`](./package.json)):

```bash
pnpm --dir examples demo              # showcase + mixed-issues
pnpm --dir examples demo:showcase
pnpm --dir examples demo:mixed-issues
pnpm --dir examples build:green       # build healthy mixed-federation
pnpm --dir examples test:e2e          # Playwright green path
```

Or with the workspace filter:

```bash
pnpm --filter @mfdoctor-example/demos demo
```
