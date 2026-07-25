export default {
  bundler: "vite",
  mode: "ci",
  output: { formats: ["terminal"] },
  rules: {
    "doctor/partial-analysis": "off",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
    "config/remote-manifest-recommended": "off",
    "config/remote-type-urls-missing": "off",
    "reliability/version-first-offline-remotes": "off",
  },
  moduleFederation: {
    name: "remote_localhost_in_production",
    manifest: true,
    remotes: {
      // Loopback remotes break when the build is promoted beyond this machine.
      shop: "http://localhost:3001/remoteEntry.js",
    },
    shared: {},
  },
};
