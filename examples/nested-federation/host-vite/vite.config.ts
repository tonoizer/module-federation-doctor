import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const mfOptions = {
  name: "nested_host_vite",
  manifest: true,
  remotes: {
    viteRemote: {
      type: "module",
      name: "nested_vite_remote",
      entry: "http://127.0.0.1:3010/remoteEntry.js",
      entryGlobalName: "nested_vite_remote",
      shareScope: "default",
    },
    rsbuildRemote: {
      type: "global",
      name: "nested_rsbuild_remote",
      entry: "http://127.0.0.1:3011/remoteEntry.js",
      entryGlobalName: "nested_rsbuild_remote",
      shareScope: "default",
    },
  },
  shared: {
    react: { singleton: true, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: true, requiredVersion: "^19.1.0" },
  },
};

export default defineConfig({
  plugins: [
    react(),
    federation(mfOptions),
    federationDoctor({
      moduleFederation: mfOptions,
      rules: {
        // Nested demo has no manifest CDN; production apps should prefer manifests.
        "config/remote-manifest-recommended": "off",
        // Direct Vite↔Rspack/Rsbuild interoperability fixture, not offline recovery.
        "reliability/version-first-offline-remotes": "off",
        "vite/manual-chunks-conflict": "off",
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    origin: "http://127.0.0.1:5180",
  },
  preview: { host: "127.0.0.1", port: 5180, strictPort: true },
  build: { target: "esnext" },
});
