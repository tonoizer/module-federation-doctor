export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "vite/remotes-prefer-module": "off",
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/remote-manifest-recommended": "off",
    "config/remote-localhost-in-production": "off",
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
