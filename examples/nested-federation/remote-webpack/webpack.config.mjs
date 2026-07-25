import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/webpack";
import { ModuleFederationDoctorPlugin } from "@module-federation/doctor/webpack";

const root = path.dirname(fileURLToPath(import.meta.url));

const mfOptions = {
  name: "nested_webpack_remote",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.js" },
  shared: {},
};

export default {
  mode: "production",
  context: root,
  entry: "./src/index.js",
  output: {
    path: path.join(root, "dist"),
    publicPath: "auto",
    uniqueName: "nested_webpack_remote",
    clean: true,
  },
  plugins: [
    new ModuleFederationPlugin(mfOptions),
    ModuleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
};
