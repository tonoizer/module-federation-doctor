export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/runtime-plugin-missing": "off",
  },
  moduleFederation: {
    name: "runtime_plugin_invalid_factory",
    manifest: true,
    // Local runtime plugin whose default export is not a factory.
    runtimePlugins: ["./src/invalid-factory.ts"],
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
