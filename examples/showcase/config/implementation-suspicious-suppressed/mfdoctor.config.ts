export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    // Intentional: custom runtime is reviewed and pinned outside MFDoctor heuristics.
    "config/implementation-suspicious": "off",
  },
  moduleFederation: {
    name: "implementation_suspicious_suppressed",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    implementation: "custom-runtime",
    shared: {},
  },
};
