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
    // Empty name triggers config/name-required.
    name: "",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
