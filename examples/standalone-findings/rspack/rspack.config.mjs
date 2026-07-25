import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { moduleFederationDoctorPlugin } from "@module-federation/doctor/rspack";

const mfOptions = {
  name: "standalone_rspack",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.tsx" },
  shared: {
    // React 18 installed while requiredVersion asks for ^19 → version-unsatisfied.
    // singleton: false → singleton-risk.
    react: { singleton: false, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: false, requiredVersion: "^19.1.0" },
  },
};

export default {
  mode: "production",
  entry: "./src/index.ts",
  output: { publicPath: "auto", uniqueName: "standalone_rspack", clean: true },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "builtin:swc-loader",
            options: {
              jsc: {
                parser: { syntax: "typescript", tsx: true },
                transform: { react: { runtime: "automatic" } },
              },
            },
          },
        ],
      },
    ],
  },
  resolve: { extensions: [".tsx", ".ts", ".jsx", ".js"] },
  plugins: [
    new ModuleFederationPlugin(mfOptions),
    moduleFederationDoctorPlugin({ moduleFederation: mfOptions, failOn: "never" }),
  ],
};
