/** Rspack remote MF options for CLI `mfdoctor check` (mirrors rspack.config.mjs). */
const mfOptions = {
  name: "rspack_remote_issues",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  shared: {
    react: { singleton: false, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: false, requiredVersion: "^19.1.0" },
  },
};

export default {
  bundler: "rspack",
  mode: "ci",
  moduleFederation: mfOptions,
};
