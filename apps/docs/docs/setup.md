# Vite, Rspack, and Rsbuild setup

Keep one `mfOptions` object and pass it to both Module Federation and Doctor.
Explicit options give Doctor the safest and most complete input.

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
