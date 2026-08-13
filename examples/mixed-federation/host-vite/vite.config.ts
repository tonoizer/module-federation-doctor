import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const portOffset = Number(process.env.MFDOCTOR_E2E_PORT_OFFSET ?? 0);
const e2ePort = (basePort: number) => basePort + portOffset;

const mfOptions = {
  name: "host_vite",
  manifest: true,
  remotes: {
    rspackRemote: {
      type: "global",
      name: "rspack_remote",
      entry: `http://127.0.0.1:${e2ePort(3001)}/remoteEntry.js`,
      entryGlobalName: "rspack_remote",
      shareScope: "default",
    },
    rsbuildRemote: {
      type: "global",
      name: "rsbuild_remote",
      entry: `http://127.0.0.1:${e2ePort(3002)}/remoteEntry.js`,
      entryGlobalName: "rsbuild_remote",
      shareScope: "default",
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
        // Local preview remotes are intentional for this example.
        "config/remote-localhost-in-production": "off",
        // MF vite may inject chunk groups; this demo is not testing that dialect.
        "vite/manual-chunks-conflict": "off",
      },
    }),
  ],
  // Bind IPv4 loopback explicitly — `localhost` can resolve to ::1 in CI while
  // the rspack static server (and Playwright probes) use 127.0.0.1.
  server: {
    host: "127.0.0.1",
    port: e2ePort(5173),
    strictPort: true,
    origin: `http://127.0.0.1:${e2ePort(5173)}`,
  },
  preview: { host: "127.0.0.1", port: e2ePort(5173), strictPort: true },
  build: { target: "esnext" },
});
