export default {
  bundler: "rspack",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
  },
  moduleFederation: {
    name: "shared_import_false",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      react: { singleton: true, requiredVersion: "^19.1.0", import: false },
    },
  },
};
