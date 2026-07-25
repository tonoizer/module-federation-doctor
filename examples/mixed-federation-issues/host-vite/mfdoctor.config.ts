/** Host MF options for CLI `mfdoctor check` (mirrors vite.config.ts). */
const mfOptions = {
  name: "host_vite_issues",
  manifest: true,
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

export default {
  bundler: "vite",
  mode: "ci",
  moduleFederation: mfOptions,
};
