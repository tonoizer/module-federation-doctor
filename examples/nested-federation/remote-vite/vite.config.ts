import { federation } from "@module-federation/vite";
import { federationDoctor } from "@module-federation/doctor/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const mfOptions = {
  name: "nested_vite_remote",
  filename: "remoteEntry.js",
  manifest: true,
  exposes: {
    "./Panel": "./src/Panel.tsx",
  },
  remotes: {
    rspackRemote: {
      type: "global",
      name: "nested_rspack_remote",
      entry: "http://127.0.0.1:3012/remoteEntry.js",
      entryGlobalName: "nested_rspack_remote",
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
        "config/remote-manifest-recommended": "off",
        "reliability/version-first-offline-remotes": "off",
        "vite/manual-chunks-conflict": "off",
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 3010,
    strictPort: true,
    origin: "http://127.0.0.1:3010",
    cors: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 3010,
    strictPort: true,
    cors: true,
  },
  build: {
    target: "esnext",
    modulePreload: false,
  },
  base: "http://127.0.0.1:3010/",
});
