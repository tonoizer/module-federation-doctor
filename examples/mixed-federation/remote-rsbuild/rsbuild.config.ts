import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import doctor from "@module-federation/doctor/rsbuild";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const mfOptions = {
  name: "rsbuild_remote",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  shared: {
    react: { singleton: true, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: true, requiredVersion: "^19.1.0" },
  },
};

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation(mfOptions),
    doctor({ moduleFederation: mfOptions, mode: "ci" }),
  ],
  server: {
    port: 3002,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  output: { assetPrefix: "auto" },
});
