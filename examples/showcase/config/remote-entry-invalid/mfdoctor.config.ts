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
    name: "remote_entry_invalid",
    manifest: true,
    // Neither a URL nor name@version / versioned remote.
    remotes: { shop: "shop" },
    shared: {},
  },
};
