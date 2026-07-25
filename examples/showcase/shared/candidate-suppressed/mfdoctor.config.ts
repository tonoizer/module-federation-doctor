export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    // Intentional: this app ships React without sharing (demo suppress path).
    "shared/candidate": "off",
  },
  moduleFederation: {
    name: "shared_candidate_suppressed",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    // react is imported + declared but not shared — would fire shared/candidate.
    shared: {},
  },
};
