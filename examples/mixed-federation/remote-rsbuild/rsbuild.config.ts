import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import doctor from "@module-federation/doctor/rsbuild";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const mfOptions = {
  name: "rsbuild_remote",
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

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation(mfOptions),
    doctor({ moduleFederation: doctorOptions, mode: "ci" }),
  ],
  server: {
    port: 3002,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  output: { assetPrefix: "auto" },
});
