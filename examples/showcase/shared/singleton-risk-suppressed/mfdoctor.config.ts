export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    // Intentional: multi-instance React accepted for this fixture.
    "shared/singleton-risk": "off",
  },
  moduleFederation: {
    name: "singleton_risk_suppressed",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      react: { singleton: false, requiredVersion: "^19.1.0" },
    },
  },
};
