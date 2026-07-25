export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/remote-manifest-recommended": "off",
  },
  moduleFederation: {
    name: "version_first_offline",
    manifest: true,
    shareStrategy: "version-first",
    remotes: {
      shop: "http://localhost:3001/remoteEntry.js",
    },
    shared: {},
  },
};
