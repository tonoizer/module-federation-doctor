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
    name: "dts_output_dir_mismatch",
    filename: "static/js/remoteEntry.js",
    manifest: true,
    exposes: { "./Widget": "./src/Widget.ts" },
    dts: {
      generateTypes: {
        outputDir: "dist/types",
      },
    },
    shared: {},
  },
};
