export default {
  bundler: "rsbuild",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
  },
  moduleFederation: {
    name: "eager_without_singleton",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // eager without singleton triggers shared/eager-without-singleton.
      react: { eager: true, singleton: false, requiredVersion: "^19.1.0" },
    },
  },
};
