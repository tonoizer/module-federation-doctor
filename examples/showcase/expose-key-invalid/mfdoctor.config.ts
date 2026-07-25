export default {
  bundler: "rspack",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/expose-path-missing": "off",
  },
  moduleFederation: {
    name: "expose_key_invalid",
    manifest: true,
    // Expose keys must start with "./".
    exposes: { Widget: "./src/Widget.ts" },
    shared: {},
  },
};
