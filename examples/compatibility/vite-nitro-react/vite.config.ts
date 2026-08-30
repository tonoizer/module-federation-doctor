import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const nitroDtsGenerateTypes = { outputDir: ".output/public" };
// @module-federation/vite's current declaration omits the dts-plugin
// `outputDir` extension even though the runtime forwards it.
const nitroDtsOptions = { generateTypes: nitroDtsGenerateTypes } as never;

const mfOptions = {
  name: "vite_nitro_react",
  filename: "remoteEntry.js",
  manifest: true,
  // Nitro SSR uses react-dom/server.edge; the client hydrates via
  // react-dom/client. Share the react-dom/ prefix so both negotiate one copy,
  // and keep the explicit server.edge key for the SSR contract.
  exposes: { "./App": "./src/app.tsx" },
  shared: {
    react: { singleton: true, requiredVersion: "^19.2.0" },
    "react-dom": { singleton: true, requiredVersion: "^19.2.0" },
    "react-dom/": { singleton: true, requiredVersion: "^19.2.0" },
    "react-dom/server.edge": { singleton: true, requiredVersion: "^19.2.0" },
  },
  // The current dts plugin accepts outputDir at runtime. Keep generated
  // declarations beside the deployed Nitro client manifest, not in Vite's
  // unrelated default `dist` directory.
  dts: nitroDtsOptions,
};

export default defineConfig({
  // Keep Nitro's official plugin/React setup intact, then attach Federation
  // and MFDoctor so both the browser and SSR environments are observed.
  plugins: [
    nitro(),
    react(),
    federation(mfOptions),
    federationDoctor({ moduleFederation: mfOptions }),
  ],
  environments: {
    client: {
      build: { rollupOptions: { input: "./src/entry-client.tsx" } },
    },
  },
});
