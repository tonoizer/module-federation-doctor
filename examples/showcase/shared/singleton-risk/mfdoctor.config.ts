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
    name: "singleton_risk",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Framework package without singleton.
      react: { singleton: false, requiredVersion: "^19.1.0" },
    },
  },
};
