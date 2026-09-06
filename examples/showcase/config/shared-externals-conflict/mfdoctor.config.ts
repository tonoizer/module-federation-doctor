export default {
  bundler: "webpack",
  mode: "ci",
  output: { formats: ["terminal"] },
  externals: { react: "React" },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "shared/singleton-risk": "off",
    "shared/unused": "off",
    "shared/candidate": "off",
  },
  moduleFederation: {
    name: "shared_externals_conflict",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      react: { singleton: true, requiredVersion: "^19" },
    },
  },
};
