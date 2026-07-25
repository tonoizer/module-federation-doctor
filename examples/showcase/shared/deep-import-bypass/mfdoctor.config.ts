export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "shared/unused": "off",
  },
  moduleFederation: {
    name: "deep_import_bypass",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Root key shared, but source imports lodash/cloneDeep (bypass).
      lodash: { singleton: false, requiredVersion: "^4.17.0" },
    },
  },
};
