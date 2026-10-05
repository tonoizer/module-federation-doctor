import path from "node:path";
import { fileURLToPath } from "node:url";
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

const mfOptions = {
  name: "rolldown_smoke",
  manifest: true,
  dts: false,
  filename: "remoteEntry.js",
  exposes: { "./Widget": "./src/Widget.js" },
  shared: {},
};

export default defineConfig({
  root,
  plugins: [
    federation(mfOptions),
    federationDoctor({
      moduleFederation: mfOptions,
      rules: {
        "artifact/types-missing": "off",
        "artifact/dts-disabled": "off",
      },
    }),
  ],
  build: { target: "esnext" },
});
