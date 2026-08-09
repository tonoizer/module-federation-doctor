import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { moduleFederationDoctorPlugin } from "@module-federation/doctor/rspack";

const portOffset = Number(process.env.MFDOCTOR_E2E_PORT_OFFSET ?? 0);

const mfOptions = {
  name: "rspack_remote_issues",
  manifest: true,
  filename: "remoteEntry.js",
  exposes: { "./Card": "./src/Card.tsx" },
  shared: {
    // React 18 is installed while requiredVersion asks for ^19 → version-unsatisfied.
    // singleton: false clashes with the host → singleton-mismatch + singleton-risk.
    react: { singleton: false, requiredVersion: "^19.1.0" },
    "react-dom": { singleton: false, requiredVersion: "^19.1.0" },
  },
};

export default {
  mode: "development",
  entry: "./src/index.ts",
  output: { publicPath: "auto", uniqueName: "rspack_remote_issues", clean: true },
  devServer: {
    port: 3011 + portOffset,
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
    moduleFederationDoctorPlugin({ moduleFederation: mfOptions, failOn: "never" }),
  ],
};
