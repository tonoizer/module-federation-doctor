import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const mfOptions = {
  name: "standalone_vite",
  manifest: true,
  // Default shareStrategy is version-first → reliability/version-first-offline-remotes.
  remotes: {
    // Non-localhost plain HTTP + remoteEntry.js → remote-http-insecure +
    // remote-manifest-recommended.
    shop: {
      type: "module",
      name: "shop",
      entry: "http://cdn.example.com/remoteEntry.js",
      entryGlobalName: "shop",
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
    // failOn never so the red cell still builds and emits project facts.
    federationDoctor({ moduleFederation: mfOptions, failOn: "never" }),
  ],
  build: { target: "esnext" },
});
