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
    name: "version_unsatisfied",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      // Installed react@18.3.1 does not satisfy ^19.
      react: { singleton: true, requiredVersion: "^19.1.0" },
    },
  },
};
