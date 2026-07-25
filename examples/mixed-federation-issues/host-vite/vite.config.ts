import { federation } from "@module-federation/vite";
import doctor from "@module-federation/doctor/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const mfOptions = {
  name: "host_vite_issues",
  manifest: true,
  // Default shareStrategy is version-first; leave it so Doctor can report
  // reliability/version-first-offline-remotes for this red demo.
  remotes: {
    rspackRemote: {
      type: "global",
      name: "rspack_remote_issues",
      entry: "http://localhost:3011/remoteEntry.js",
      entryGlobalName: "rspack_remote_issues",
      shareScope: "default",
    },
    rsbuildRemote: {
      type: "global",
      name: "rsbuild_remote_issues",
      entry: "http://localhost:3012/remoteEntry.js",
      entryGlobalName: "rsbuild_remote_issues",
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
    // Intentionally leave remote-manifest-recommended and
    // reliability/version-first-offline-remotes enabled so the host report is red.
    // failOn never so the red suite still builds and emits project facts.
    doctor({ moduleFederation: mfOptions, mode: "ci", failOn: "never" }),
  ],
  server: { port: 5183, strictPort: true },
  preview: { port: 5183, strictPort: true },
  build: { target: "esnext" },
});
