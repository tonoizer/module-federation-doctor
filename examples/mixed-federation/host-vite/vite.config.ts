import { federation } from "@module-federation/vite";
import { federationDoctor } from "@module-federation/doctor/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const mfOptions = {
  name: "host_vite",
  manifest: true,
  remotes: {
    rspackRemote: {
      type: "global",
      name: "rspack_remote",
      entry: "http://localhost:3001/remoteEntry.js",
      entryGlobalName: "rspack_remote",
      shareScope: "default",
    },
    rsbuildRemote: {
      type: "global",
      name: "rsbuild_remote",
      entry: "http://localhost:3002/remoteEntry.js",
      entryGlobalName: "rsbuild_remote",
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
    // CI is auto-detected (CI / GITHUB_ACTIONS / …) → failOn: "error" + SARIF.
    federationDoctor({
      moduleFederation: mfOptions,
      rules: {
        // This local example has no manifest server. Production apps should
        // prefer manifest URLs so tooling can inspect richer metadata.
        "config/remote-manifest-recommended": "off",
        // Keep version-first here because this fixture tests direct
        // Vite-to-Rspack/Rsbuild interoperability, not offline recovery.
        "reliability/version-first-offline-remotes": "off",
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { target: "esnext" },
});
