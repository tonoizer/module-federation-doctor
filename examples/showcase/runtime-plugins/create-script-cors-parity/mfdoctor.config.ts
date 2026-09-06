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
    name: "runtime_plugin_cors_parity",
    manifest: true,
    // Local plugin customizes createScript CORS but omits createLink.
    runtimePlugins: ["./src/cors-plugin.ts"],
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
