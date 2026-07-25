# Vite, Rspack, and Rsbuild setup

Install Doctor as a **devDependency** (`pnpm add -D @module-federation/doctor`).
Keep one `mfOptions` object and pass it to both Module Federation and Doctor.
Explicit options give Doctor the safest and most complete input — including MF
`runtimePlugins`, which Doctor analyzes from that config at build time.

Adapters hook **after emit** (`writeBundle` / `afterEmit` / `onAfterBuild`).
They must not inject Doctor into client assets. Analysis costs CI/build time
only; it is not shipped in the published bundle.

## Vite

```ts
import { federation } from "@module-federation/vite";
import doctor from "@module-federation/doctor/vite";

const mfOptions = { name: "host", remotes: {} };
export default { plugins: [federation(mfOptions), doctor({ moduleFederation: mfOptions })] };
```

## Rspack

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import doctor from "@module-federation/doctor/rspack";

const mfOptions = { name: "remote", exposes: { "./App": "./src/App.tsx" } };
export default {
  plugins: [new ModuleFederationPlugin(mfOptions), doctor({ moduleFederation: mfOptions })],
};
```

## Rsbuild

```ts
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import doctor from "@module-federation/doctor/rsbuild";

const mfOptions = { name: "remote", exposes: { "./App": "./src/App.tsx" } };
export default {
  plugins: [pluginModuleFederation(mfOptions), doctor({ moduleFederation: mfOptions })],
};
```

## Out of scope: runtime-only apps

Apps that use `@module-federation/runtime` / `createInstance` **without** a
Vite, Rspack, or Rsbuild Module Federation **build** plugin are not first-class
Doctor targets. There is no post-emit adapter hook, and Doctor does not parse
runtime init from source.

Do **not** add a Doctor agent to the browser bundle to close that gap (bundle
size and performance). Instead:

- prefer a bundler MF plugin + Doctor adapter with shared `mfOptions`
- use Observability exports with `mfdoctor runtime` for live correlation
- use `mfdoctor probe` for deployed producer manifests

See [limitations](./limitations.md),
[#34](https://github.com/tonoizer/module-federation-doctor/issues/34), and the
closed RFC
[#33](https://github.com/tonoizer/module-federation-doctor/issues/33).
