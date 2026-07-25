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
    name: "filename_invalid",
    manifest: true,
    // Absolute path / non-.js entry is invalid.
    filename: "/tmp/remoteEntry.txt",
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
