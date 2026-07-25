import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@module-federation/doctor/rsbuild";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const mfOptions = {
  name: "standalone_rsbuild",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.tsx" },
  shared: {
    // eager without singleton → shared/eager-without-singleton (+ singleton-risk).
    react: { eager: true, singleton: false, requiredVersion: "^19.1.0" },
    "react-dom": { eager: true, singleton: false, requiredVersion: "^19.1.0" },
  },
};

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation(mfOptions),
    pluginModuleFederationDoctor({ moduleFederation: mfOptions, failOn: "never" }),
  ],
  output: { assetPrefix: "auto" },
});
