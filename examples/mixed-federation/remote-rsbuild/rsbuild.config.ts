import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@tonoizer/mfdoctor/rsbuild";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const portOffset = Number(process.env.MFDOCTOR_E2E_PORT_OFFSET ?? 0);

const mfOptions = {
  name: "rsbuild_remote",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  shared: {
    react: { singleton: true, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: true, requiredVersion: "^19.1.0" },
    "react-dom/": { singleton: true, requiredVersion: "^19.1.0" },
  },
};

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation(mfOptions),
    pluginModuleFederationDoctor({ moduleFederation: mfOptions }),
  ],
  server: {
    host: "127.0.0.1",
    port: 3002 + portOffset,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  output: { assetPrefix: "auto" },
});
