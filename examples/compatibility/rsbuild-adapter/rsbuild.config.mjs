import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { pluginModuleFederationDoctor } from "@module-federation/doctor/rsbuild";

const firstOptions = {
  name: "rsbuild_adapter",
  manifest: true,
  filename: "firstRemoteEntry.js",
  exposes: { "./First": "./src/First.js" },
  shared: {},
};

export default {
  output: { assetPrefix: "/dist/" },
  plugins: [
    pluginModuleFederation(firstOptions),
    pluginModuleFederationDoctor({
      moduleFederation: firstOptions,
      rules: {
        "artifact/types-missing": "off",
        "artifact/dts-disabled": "off",
      },
    }),
  ],
};
