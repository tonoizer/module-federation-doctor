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
    name: "copied_webpack_options_on_vite",
    manifest: true,
    filename: "remoteEntry.js",
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
    // Webpack ModuleFederationPlugin-only keys pasted onto `@module-federation/vite`.
    remoteType: "script",
    virtualRuntimeEntry: true,
    runtime: false,
    async: true,
    experiments: {
      asyncStartup: true,
      optimization: {
        disableRemote: true,
        target: "node",
      },
    },
  },
};
