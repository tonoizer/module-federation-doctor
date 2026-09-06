export default {
  bundler: "rspack",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
  },
  moduleFederation: {
    name: "bridge_export_app_missing",
    manifest: true,
    // React Bridge producer (plugin + explicit router) without "./export-app".
    bridge: { enableBridgeRouter: true },
    runtimePlugins: ["@module-federation/bridge-react/plugin"],
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
