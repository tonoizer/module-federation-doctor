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
    name: "expose_path_missing",
    manifest: true,
    // Path does not exist under src/.
    exposes: { "./Widget": "./src/MissingWidget.ts" },
    shared: {},
  },
};
