# Examples

Three stories live here. Use the green path for healthy e2e, the red path for a
real multi-bundler report with conflicts, and the showcase for one-rule demos.

| Suite                                                  | Intent                                                 | Command                                |
| ------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------- |
| [`mixed-federation`](./mixed-federation)               | Healthy Vite + Rspack + Rsbuild e2e                    | `pnpm test:examples` / `pnpm test:e2e` |
| [`mixed-federation-issues`](./mixed-federation-issues) | Same topology, intentional shared/federation conflicts | `pnpm demo:mixed-issues`               |
| [`showcase`](./showcase)                               | Themed one-finding (or small combination) demos        | `pnpm demo:showcase`                   |

```bash
pnpm build
pnpm demo:showcase
pnpm demo:mixed-issues
```
