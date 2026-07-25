export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
  },
  moduleFederation: {
    name: "shared_unused",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Declared shared but never imported in source.
      lodash: { singleton: false, requiredVersion: "^4.17.0" },
    },
  },
};
