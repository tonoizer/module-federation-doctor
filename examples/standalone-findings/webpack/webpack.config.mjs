import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/webpack";
import { ModuleFederationDoctorPlugin } from "@module-federation/doctor/webpack";

const root = path.dirname(fileURLToPath(import.meta.url));

const mfOptions = {
  name: "standalone_webpack",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.js" },
  shared: {
    // React 18 installed while requiredVersion asks for ^19 → version-unsatisfied.
    // singleton: false → singleton-risk.
    react: { singleton: false, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: false, requiredVersion: "^19.1.0" },
  },
};

export default {
  mode: "production",
  context: root,
  entry: "./src/index.js",
  output: {
    path: path.join(root, "dist"),
    publicPath: "auto",
    uniqueName: "standalone_webpack",
    clean: true,
  },
  plugins: [
    new ModuleFederationPlugin(mfOptions),
    ModuleFederationDoctorPlugin({ moduleFederation: mfOptions, failOn: "never" }),
  ],
};
