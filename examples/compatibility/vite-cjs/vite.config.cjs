const { federationDoctor } = require("@tonoizer/mfdoctor/vite");

const mfOptions = {
  name: "vite_cjs_v5",
  manifest: true,
  dts: false,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.js" },
  shared: {},
};

module.exports = async () => {
  // Vite 5 keeps its federation plugin ESM-only. The async import is the
  // supported CommonJS-config bridge; Doctor itself is loaded through its
  // published CommonJS adapter condition above.
  const { federation } = await import("@module-federation/vite");
  return {
    plugins: [
      federation(mfOptions),
      federationDoctor({
        moduleFederation: mfOptions,
        // Vite 5 CommonJS config is intentionally a packaging/lifecycle cell.
        rules: {
          "artifact/types-missing": "off",
          "artifact/dts-disabled": "off",
        },
      }),
    ],
    build: { target: "esnext" },
  };
};
