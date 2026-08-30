import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/rspack";

const mfOptions = {
  name: "nested_rspack_remote",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  shared: {
    react: { singleton: true, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: true, requiredVersion: "^19.1.0" },
    "react-dom/": { singleton: true, requiredVersion: "^19.1.0" },
  },
};

export default {
  mode: "development",
  entry: "./src/index.ts",
  output: { publicPath: "auto", uniqueName: "nested_rspack_remote", clean: true },
  devServer: {
    port: 3012,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
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
    moduleFederationDoctorPlugin({ moduleFederation: mfOptions }),
  ],
};
