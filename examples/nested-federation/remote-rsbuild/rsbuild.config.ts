import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@tonoizer/mfdoctor/rsbuild";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const mfOptions = {
  name: "nested_rsbuild_remote",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  remotes: {
    webpackRemote: "nested_webpack_remote@http://127.0.0.1:3013/remoteEntry.js",
  },
  // Nested producer: include consumed remote types in this container's DTS archive.
  dts: {
    generateTypes: {
      extractRemoteTypes: true,
    },
  },
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
    pluginModuleFederationDoctor({
      moduleFederation: mfOptions,
      rules: {
        // Nested demo uses direct remoteEntry URLs (no manifest CDN).
        "config/remote-manifest-recommended": "off",
        // Direct .js remotes are intentional; this nested producer tests
        // extractRemoteTypes, not consumeTypes.remoteTypeUrls.
        "config/js-remote-without-type-urls": "off",
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 3011,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  output: { assetPrefix: "auto" },
});
