---
title: Bundler integrations
description: Add MFDoctor to Vite, Vite Plus, Nuxt, Rspack, Rsbuild, Webpack, or Modern.js.
---

# Bundler integrations

Choose the adapter owned by the build tool. In every example, the same
`mfOptions` object goes to Module Federation and MFDoctor. Register MFDoctor after
the federation plugin so it can inspect the completed output.

- **Vite, Rolldown-integrated Vite, or Vite Plus:** `@tonoizer/mfdoctor/vite`
  (Rolldown / Vite Plus: **partial**)
- **Nuxt 3 or Nuxt 4:** `@tonoizer/mfdoctor/nuxt` (**partial**)
- **Rspack:** `@tonoizer/mfdoctor/rspack`
- **Rsbuild:** `@tonoizer/mfdoctor/rsbuild`
- **Webpack:** `@tonoizer/mfdoctor/webpack`
- **Modern.js:** `@tonoizer/mfdoctor/modern` (**partial**)

## Vite

```ts
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";

const mfOptions = {
  name: "host",
  remotes: {},
};

export default {
  plugins: [federation(mfOptions), federationDoctor({ moduleFederation: mfOptions })],
};
```

The same adapter covers classic Vite, Rolldown-integrated Vite (`rolldown-vite`
and Vite 8+), and Vite Plus. MFDoctor selects the matching post-emit hook and
avoids duplicate analysis when a build exposes more than one lifecycle hook.
See [Vite integration](./vite-integration.md) for lifecycle and configuration
details.

## Nuxt 3 and Nuxt 4

Register MFDoctor next to the official Module Federation Nuxt module:

```ts
import moduleFederationDoctor from "@tonoizer/mfdoctor/nuxt";

const mfOptions = {
  name: "host",
  remotes: {},
};

export default defineNuxtConfig({
  modules: ["@module-federation/nuxt", [moduleFederationDoctor, { moduleFederation: mfOptions }]],
});
```

MFDoctor uses Nuxt's public `vite:extendConfig` hook for client and SSR builds.
The official Nuxt module still owns Module Federation. If that integration
already exposes `nuxt.options.moduleFederation.config`, you may omit MFDoctor's
explicit `moduleFederation` option.

## Rspack

Use this adapter for direct `@rspack/core` projects:

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/rspack";

const mfOptions = {
  name: "remote",
  exposes: { "./App": "./src/App.tsx" },
};

export default {
  plugins: [
    new ModuleFederationPlugin(mfOptions),
    moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
};
```

Use the Rspack adapter for direct Rspack builds even if the repository also
contains Modern.js or Rsbuild apps.

## Rsbuild

```ts
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@tonoizer/mfdoctor/rsbuild";

const mfOptions = {
  name: "remote",
  exposes: { "./App": "./src/App.tsx" },
};

export default {
  plugins: [
    pluginModuleFederation(mfOptions),
    pluginModuleFederationDoctor({ moduleFederation: mfOptions }),
  ],
};
```

The Rsbuild adapter runs through `onAfterBuild`, after Module Federation has
written its manifest and entry files.

## Webpack

```ts
import { ModuleFederationPlugin } from "@module-federation/enhanced/webpack";
import { ModuleFederationDoctorPlugin } from "@tonoizer/mfdoctor/webpack";

const mfOptions = {
  name: "remote",
  exposes: { "./App": "./src/App.tsx" },
};

export default {
  plugins: [
    new ModuleFederationPlugin(mfOptions),
    ModuleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
};
```

MFDoctor runs in `afterEmit`, after the enhanced Module Federation plugin has
produced the files used as evidence.

## Modern.js

Register the Modern.js adapter with `@module-federation/modern-js` or
`@module-federation/modern-js-v3`:

```ts
import { appTools, defineConfig } from "@modern-js/app-tools";
import { moduleFederationPlugin } from "@module-federation/modern-js";
import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/modern";

const mfOptions = {
  name: "remote",
  exposes: { "./App": "./src/App.tsx" },
};

export default defineConfig({
  plugins: [
    appTools(),
    moduleFederationPlugin(),
    moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
});
```

This adapter composes a post-emit plugin through `modifyBundlerChain` and
records the build as Modern.js. Support remains partial until the compatibility
suite runs a full `@modern-js/app-tools` application build.

For a direct Rspack path inside `tools.bundlerChain`, use the public Rspack
adapter instead:

```ts
import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/rspack";

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

That path records the bundler as Rspack.

## After the build

Every adapter writes project facts below `.mf/doctor/`. Build all hosts and
remotes, then compare them:

```bash
mfdoctor workspace
```

Use the [CLI command reference](./cli.md) for monorepo roots, CI formats,
federation groups, baselines, and runtime correlation. Browse
[working examples](./examples.md) for mixed Vite, Rspack, Rsbuild, and Webpack
federations.
