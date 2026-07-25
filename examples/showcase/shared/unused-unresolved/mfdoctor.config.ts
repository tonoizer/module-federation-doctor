export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "shared/singleton-risk": "off",
  },
  moduleFederation: {
    name: "shared_unused_unresolved",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Would look unused if Doctor trusted incomplete dynamic evidence.
      lodash: { singleton: false, requiredVersion: "^4.17.0" },
    },
  },
};
