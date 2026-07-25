import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import doctor from "@module-federation/doctor/rspack";

const mfOptions = {
  name: "rspack_remote",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  shared: {
    react: { singleton: true, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: true, requiredVersion: "^19.1.0" },
  },
};

const doctorOptions =
  process.env.DOCTOR_CASE === "error"
    ? { ...mfOptions, exposes: { Card: "./src/missing.tsx" } }
    : process.env.DOCTOR_CASE === "warning"
      ? {
          ...mfOptions,
          shared: {
            ...mfOptions.shared,
            react: { ...mfOptions.shared.react, eager: true, singleton: false },
          },
        }
      : mfOptions;

export default {
  mode: "development",
  entry: "./src/index.ts",
  output: { publicPath: "auto", uniqueName: "rspack_remote", clean: true },
  devServer: {
    port: 3001,
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
    doctor({ moduleFederation: doctorOptions, mode: "ci" }),
  ],
};
