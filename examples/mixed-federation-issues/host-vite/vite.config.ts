import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const portOffset = Number(process.env.MFDOCTOR_E2E_PORT_OFFSET ?? 0);
const e2ePort = (basePort: number) => basePort + portOffset;

const mfOptions = {
  name: "host_vite_issues",
  manifest: true,
  // Default shareStrategy is version-first; leave it so Doctor can report
  // reliability/version-first-offline-remotes for this red demo.
  remotes: {
    rspackRemote: {
      type: "global",
      name: "rspack_remote_issues",
      entry: `http://127.0.0.1:${e2ePort(3011)}/remoteEntry.js`,
      entryGlobalName: "rspack_remote_issues",
      shareScope: "default",
    },
    rsbuildRemote: {
      type: "global",
      name: "rsbuild_remote_issues",
      entry: `http://127.0.0.1:${e2ePort(3012)}/remoteEntry.js`,
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
    federationDoctor({
      moduleFederation: mfOptions,
      failOn: "never",
      rules: {
        "vite/manual-chunks-conflict": "off",
        "vite/server-origin": "off",
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: e2ePort(5183),
    strictPort: true,
    origin: `http://127.0.0.1:${e2ePort(5183)}`,
  },
  preview: { host: "127.0.0.1", port: e2ePort(5183), strictPort: true },
  build: { target: "esnext" },
});
