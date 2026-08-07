# Get started

Install Doctor as a **devDependency** (`pnpm add -D @module-federation/doctor`).
Keep one `mfOptions` object and pass it to both Module Federation and Doctor.
Explicit options give Doctor the safest and most complete input — including MF
`runtimePlugins`, which Doctor analyzes from that config at build time.

Supported / partial / unsupported cells (bundlers, Node, package managers,
report surfaces) are listed in the [compatibility matrix](./compatibility.md).

Doctor runs **only after emit** (`writeBundle` / `closeBundle` / `afterEmit` /
`onAfterBuild` / Modern.js `modifyBundlerChain` → `afterEmit`), prints **one**
findings block to the terminal when there are findings, then fails the build
only after every finding is collected when CI policy requires it. Clean runs
stay quiet by default (no "no findings" noise). Adapters must not inject Doctor
into client assets and must not re-print findings into bundler warning streams.
Analysis costs CI/build time only; it is not shipped in the published bundle
([#32](https://github.com/tonoizer/module-federation-doctor/issues/32),
[#46](https://github.com/tonoizer/module-federation-doctor/issues/46),
[#54](https://github.com/tonoizer/module-federation-doctor/issues/54)).

`CI` / provider env vars (or `mode: "ci"`) turn on `failOn: "error"` and SARIF
output automatically. You do **not** need `mode: "ci"` in plugin config when CI
already exports those variables.

## First finding

1. Register the plugin (below) and run a normal production build.
2. Read the terminal block: severity, rule id, message, short fix, docs URL.
3. Open the matching page under [Rule reference](./rules/) and apply the fix.
4. Rebuild until the process exits **0**. Agents should treat that loop as the
   whole job — do not stop while findings remain that policy fails on.
5. If a finding is intentional product policy, mute that rule (or baseline the
   fingerprint) instead of removing Doctor — see
   [Governance](./suppressions.md).

## Which adapter?

| Project surface                | Doctor entry                        | Notes                                                                                  |
| ------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------- |
| Vite                           | `@module-federation/doctor/vite`    | Primary host path                                                                      |
| Nuxt 3 / Nuxt 4                | `@module-federation/doctor/nuxt`    | Public `vite:extendConfig`; observes client + SSR builds                               |
| Direct Rspack (`@rspack/core`) | `@module-federation/doctor/rspack`  | First-class; do **not** replace with the Modern.js entry                               |
| Rsbuild                        | `@module-federation/doctor/rsbuild` | `onAfterBuild`                                                                         |
| Webpack                        | `@module-federation/doctor/webpack` | `@module-federation/enhanced/webpack`                                                  |
| Modern.js (`modern.config.*`)  | `@module-federation/doctor/modern`  | **partial** — composes post-emit via `modifyBundlerChain`; records `bundler: "modern"` |

Modern.js builds on Rspack (or Webpack). The Modern.js adapter is a convenience
for `modern.config` — it does **not** deprecate direct Rspack coverage. Matrix
status is **partial** until CI runs a real `@modern-js/app-tools` build (today’s
smoke stubs `modifyBundlerChain` on Rspack).

## Terminal output knobs

| Knob                          | Effect                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| default                       | Quiet success — print nothing when there are zero findings |
| `printLog: { success: true }` | Restore the green "no findings" line                       |
| `quiet: false`                | Same as enabling `printLog.success`                        |
| `quiet: true`                 | Force quiet success (default)                              |
| `MFDOCTOR_QUIET=1`            | Force quiet (wins over config)                             |
| `MFDOCTOR_QUIET=0`            | Allow the success line (wins over config)                  |
| CLI `--verbose`               | Sets `quiet: false` / `printLog.success: true`             |

Each printed finding includes severity, rule id, message, short fix, a Doctor
rule docs URL, and official `module-federation.io` sources when available.

## Vite

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@module-federation/doctor/vite";

const mfOptions = { name: "host", remotes: {} };
export default {
  plugins: [federation(mfOptions), federationDoctor({ moduleFederation: mfOptions })],
};
```

The same `@module-federation/doctor/vite` entry covers classic Vite,
Rolldown-integrated Vite (`rolldown-vite` / Vite 8+), and Vite Plus. See
[Vite integration](./vite-integration.md#rolldown-and-vite-plus).

## Nuxt 3 and Nuxt 4

Register the Doctor Nuxt module next to the official Module Federation Nuxt
module. Pass the same federation options to both integrations when the
application owns the configuration:

```ts
import nuxtDoctor from "@module-federation/doctor/nuxt";

const mfOptions = { name: "host", remotes: {} };

export default defineNuxtConfig({
  modules: ["@module-federation/nuxt", [nuxtDoctor, { moduleFederation: mfOptions }]],
});
```

The adapter uses Nuxt's public `vite:extendConfig` hook, so it observes the
client and SSR Vite configurations in Nuxt 3 and Nuxt 4. It only adds Doctor;
the official federation Nuxt module remains responsible for the federation
plugin. If the Nuxt integration already exposes its config on
`nuxt.options.moduleFederation.config`, the explicit `moduleFederation` option
can be omitted.

## Rspack

Use this for **direct** `@rspack/core` projects (not Modern.js / Rsbuild wrappers).

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
import { ModuleFederationDoctorPlugin } from "@module-federation/doctor/webpack";

const mfOptions = { name: "remote", exposes: { "./App": "./src/App.tsx" } };
export default {
  plugins: [
    new ModuleFederationPlugin(mfOptions),
    ModuleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
};
```

## Modern.js

Register next to `@module-federation/modern-js` / `@module-federation/modern-js-v3`.
Doctor attaches through Modern.js `modifyBundlerChain` using the same post-emit
analysis as the Rspack/Webpack adapters.

```ts
import { appTools, defineConfig } from "@modern-js/app-tools";
import { moduleFederationPlugin } from "@module-federation/modern-js";
import { moduleFederationDoctorPlugin } from "@module-federation/doctor/modern";

const mfOptions = { name: "remote", exposes: { "./App": "./src/App.tsx" } };

export default defineConfig({
  plugins: [
    appTools(),
    moduleFederationPlugin(),
    moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
});
```

Escape hatch — keep using the **public Rspack adapter** inside Modern.js
`tools.bundlerChain` (facts record `bundler: "rspack"`):

```ts
import { moduleFederationDoctorPlugin } from "@module-federation/doctor/rspack";
// or: import { appendModuleFederationDoctor } from "@module-federation/doctor/modern";

export default defineConfig({
  tools: {
    bundlerChain(chain) {
      chain
        .plugin("module-federation-doctor")
        .use(moduleFederationDoctorPlugin({ moduleFederation: mfOptions }));
    },
  },
});
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
Vite, Rspack, Rsbuild, Webpack, or Modern.js Module Federation **build** plugin are not
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
