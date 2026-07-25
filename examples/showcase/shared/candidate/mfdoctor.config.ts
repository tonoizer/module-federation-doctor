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
    name: "shared_candidate",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    // react is imported + declared but not shared.
    shared: {},
  },
};
