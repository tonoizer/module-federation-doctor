import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import doctor from "@module-federation/doctor/rsbuild";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const mfOptions = {
  name: "rsbuild_remote_issues",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  // Declare legacy so share-scope-undeclared stays quiet; federation still
  // sees a different scope than the host/rspack remotes.
  shareScope: ["default", "legacy"],
  shared: {
    react: { singleton: true, requiredVersion: "^19.1.0", shareScope: "legacy" },
    "react-dom": { singleton: true, requiredVersion: "^19.1.0", shareScope: "legacy" },
  },
};

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation(mfOptions),
    doctor({ moduleFederation: mfOptions, mode: "ci", failOn: "never" }),
  ],
  server: {
    port: 3012,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  output: { assetPrefix: "auto" },
});
