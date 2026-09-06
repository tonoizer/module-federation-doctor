export default {
  bundler: "webpack",
  mode: "ci",
  output: { formats: ["terminal"] },
  resolveAliases: {
    react: "./src/shims/react.ts",
  },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "artifact/types-missing": "off",
    "artifact/types-metadata-missing": "off",
    "artifact/manifest-disabled": "off",
  },
  moduleFederation: {
    name: "alias_share_bypass",
    filename: "remoteEntry.js",
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {
      react: { singleton: true },
    },
  },
};
