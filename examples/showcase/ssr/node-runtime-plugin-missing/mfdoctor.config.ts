export default {
  bundler: "rspack",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "artifact/types-missing": "off",
    "artifact/types-metadata-missing": "off",
    "artifact/dts-disabled": "off",
    "artifact/manifest-disabled": "off",
  },
  moduleFederation: {
    name: "ssr_node_runtime_plugin_missing",
    manifest: true,
    // Vite `target` plus Enhanced `experiments.optimization.target` both normalize
    // to node/SSR dual-env facts for `ssr/*` rules.
    target: "node",
    experiments: { optimization: { target: "node" } },
    library: { type: "commonjs-module" },
    dts: false,
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
