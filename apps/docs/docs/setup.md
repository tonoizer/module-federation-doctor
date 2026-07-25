# Vite, Rspack, Rsbuild, and Webpack setup

Install Doctor as a **devDependency** (`pnpm add -D @module-federation/doctor`).
Keep one `mfOptions` object and pass it to both Module Federation and Doctor.
Explicit options give Doctor the safest and most complete input — including MF
`runtimePlugins`, which Doctor analyzes from that config at build time.

Supported / partial / unsupported cells (bundlers, Node, package managers,
report surfaces) are listed in the [compatibility matrix](./compatibility.md).

Doctor runs after emit (`writeBundle` / `afterEmit` / `onAfterBuild`), prints
findings to the terminal (and bundler logs), then fails the build only after
every finding is collected when CI policy requires it. Adapters must not inject
Doctor into client assets. Analysis costs CI/build time only; it is not shipped
in the published bundle
([#32](https://github.com/tonoizer/module-federation-doctor/issues/32)).

`CI` / provider env vars (or `mode: "ci"`) turn on `failOn: "error"` and SARIF
output automatically. You do **not** need `mode: "ci"` in plugin config when CI
already exports those variables.

## Vite

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@module-federation/doctor/vite";

const mfOptions = { name: "host", remotes: {} };
export default {
  plugins: [federation(mfOptions), federationDoctor({ moduleFederation: mfOptions })],
};
```

## Rspack

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { moduleFederationDoctorPlugin } from "@module-federation/doctor/rspack";

const mfOptions = { name: "remote", exposes: { "./App": "./src/App.tsx" } };
export default {
  plugins: [
    new ModuleFederationPlugin(mfOptions),
    moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
};
```

## Rsbuild

```ts
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@module-federation/doctor/rsbuild";

const mfOptions = { name: "remote", exposes: { "./App": "./src/App.tsx" } };
export default {
  plugins: [
    pluginModuleFederation(mfOptions),
    pluginModuleFederationDoctor({ moduleFederation: mfOptions }),
  ],
};
```

## Webpack

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/webpack";
import { moduleFederationDoctorPlugin } from "@module-federation/doctor/webpack";

const mfOptions = { name: "remote", exposes: { "./App": "./src/App.tsx" } };
export default {
  plugins: [
    new ModuleFederationPlugin(mfOptions),
    moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
};
```

## Supported analysis paths

| Path                                                                                 | Covered?                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| Bundler MF plugin + Doctor adapter + shared `mfOptions` (including `runtimePlugins`) | Yes — primary                                 |
| CLI `check` with explicit `moduleFederation` / `module-federation.config`            | Partial (config/imports; weaker without emit) |
| On-disk / deployed `mf-manifest.json` (`check` discover / `probe`)                   | Producer/deploy evidence only                 |
| `mfdoctor runtime` + Observability export                                            | Opt-in live correlation, offline              |

## Multi-app CI loop

One-shot path after each host/remote builds with the Doctor plugin:

```bash
mfdoctor workspace
# or: mfdoctor federation --workspace
mfdoctor workspace apps packages --format terminal,json,sarif
```

That auto-discovers `**/.mf/doctor/project.json` under the given roots and runs
cross-app shared, name, and provider checks. Exit codes match the rest of the
CLI: `0` pass, `1` policy fail, `2` analysis incomplete (for example no project
facts found).

Manual globs remain available as an escape hatch when discovery roots are not
enough:

```bash
mfdoctor federation ".mf/doctor/**/project.json"
mfdoctor federation "packages/*/.mf/doctor/project.json"
```

Optionally run `mfdoctor probe <manifest-url>` against deployed remotes.

For GitHub Actions, reuse
[`.github/actions/workspace-federation-gate`](https://github.com/tonoizer/module-federation-doctor/tree/main/.github/actions/workspace-federation-gate)
after your builds. See [CLI and CI](./cli.md).

## Out of scope: runtime-only apps

Apps that use `@module-federation/runtime` / `createInstance` **without** a
Vite, Rspack, Rsbuild, or Webpack Module Federation **build** plugin are not
first-class Doctor targets
([#34](https://github.com/tonoizer/module-federation-doctor/issues/34),
`MFDOCTOR-117`). There is no post-emit adapter hook, and Doctor does not parse
runtime init from source.

Analyzing MF **`runtimePlugins` via build-time config** (shared `mfOptions`
passed into the adapter) **is** supported. That path is different from a
runtime-only app that never uses a bundler MF plugin.

Do **not** add a Doctor agent to the browser bundle to close that gap (bundle
size and performance;
[#33](https://github.com/tonoizer/module-federation-doctor/issues/33)). Instead:

- prefer a bundler MF plugin + Doctor adapter with shared `mfOptions`
- use Observability exports with `mfdoctor runtime` for live correlation
- use `mfdoctor probe` for deployed producer manifests

See [limitations](./limitations.md).
