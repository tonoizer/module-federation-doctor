# Vite, Rspack, and Rsbuild setup

Keep one `mfOptions` object and pass it to both Module Federation and Doctor.
Explicit options give Doctor the safest and most complete input. Doctor runs
after emit, prints findings to the terminal (and bundler logs), then fails the
build only after every finding is collected when CI policy requires it.

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

## Multi-app CI loop

1. Build each host and remote with the Doctor plugin so each app writes
   `.mf/doctor/project.json`.
2. Run `mfdoctor federation ".mf/doctor/**/project.json"` for cross-app shared,
   name, and provider conflicts.
3. Optionally run `mfdoctor probe <manifest-url>` against deployed remotes.
