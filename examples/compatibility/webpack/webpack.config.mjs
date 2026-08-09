import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleFederationPlugin } from "@module-federation/enhanced/webpack";
import { ModuleFederationDoctorPlugin } from "@module-federation/doctor/webpack";

const root = path.dirname(fileURLToPath(import.meta.url));

const checkoutOptions = {
  name: "webpack_smoke_checkout",
  manifest: { filePath: "checkout" },
  filename: "checkout/checkoutRemoteEntry.js",
  exposes: { "./Widget": "./src/Widget.js" },
  shared: {},
};

const catalogOptions = {
  name: "webpack_smoke_catalog",
  manifest: { filePath: "catalog" },
  filename: "catalog/catalogRemoteEntry.js",
  exposes: { "./Catalog": "./src/Catalog.js" },
  shared: {},
};

export default {
  mode: "production",
  context: root,
  entry: "./src/index.js",
  output: {
    path: path.join(root, "dist"),
    publicPath: "auto",
    uniqueName: "webpack_smoke",
    clean: true,
  },
  plugins: [
    new ModuleFederationPlugin(checkoutOptions),
    new ModuleFederationPlugin(catalogOptions),
    ModuleFederationDoctorPlugin({ moduleFederation: checkoutOptions }),
  ],
};
