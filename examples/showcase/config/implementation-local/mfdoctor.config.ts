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
    name: "implementation_local",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    // Local path — heuristic does not fire (intentional non-firing).
    implementation: "./runtime-tools",
    shared: {},
  },
};
