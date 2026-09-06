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
    "shared/candidate": "off",
    "shared/deep-import-bypass": "off",
    "shared/prefix-share-recommended": "off",
  },
  moduleFederation: {
    name: "react_dom_server_in_web",
    manifest: true,
    // Default web/client remote accidentally imports react-dom/server.
    experiments: { target: "web" },
    exposes: { "./Widget": "./src/Widget.ts" },
    shared: {},
  },
};
