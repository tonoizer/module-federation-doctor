# Examples

Seven stories live here. Use the flat green path for healthy e2e, nested for
multi-level multi-bundler orchestration, standalone cells for per-bundler
build+MFDoctor findings, the red path for intentional conflicts, the showcase for
one-rule demos, and compatibility for production framework/bundler smoke.

| Suite                                                                | Intent                                                         | Command                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| [`mixed-federation`](./mixed-federation)                             | Healthy Vite + Rspack + Rsbuild e2e                            | `vp run test:examples` / `vp run test:e2e`  |
| [`nested-federation`](./nested-federation)                           | Nested Vite host → Vite/Rsbuild → Rspack/Webpack               | `vp run test:nested` / `vp run demo:nested` |
| [`standalone-findings`](./standalone-findings)                       | Per-bundler standalone cells with visible MFDoctor findings    | `vp run demo:standalone`                    |
| [`mixed-federation-issues`](./mixed-federation-issues)               | Same flat topology, intentional shared/federation conflicts    | `vp run demo:mixed-issues`                  |
| [`showcase`](./showcase)                                             | One-rule CLI fixtures (config / shared / federation / runtime) | `vp run demo:showcase`                      |
| [`compatibility/webpack`](./compatibility/webpack)                   | Webpack smoke for the compatibility matrix                     | compatibility workflow                      |
| [`compatibility/vite-nitro-react`](./compatibility/vite-nitro-react) | Vite + Nitro + React SSR output-shape smoke                    | compatibility workflow                      |

From the repo root:

```bash
vp run --filter . build
vp run demo:showcase
vp run demo:standalone
vp run demo:mixed-issues
vp run demo:nested
```

From this folder (via [`package.json`](./package.json)):

```bash
vp run demo              # showcase + standalone + mixed-issues + nested
vp run demo:showcase
vp run demo:standalone
vp run demo:mixed-issues
vp run demo:nested
vp run build:green       # build healthy mixed-federation
vp run test:e2e          # full E2E gate
```

Or with the workspace filter:

```bash
vp run --filter @mfdoctor-example/demos demo
```
