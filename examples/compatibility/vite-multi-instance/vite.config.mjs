import path from "node:path";
import { fileURLToPath } from "node:url";
import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

const firstOptions = {
  name: "vite_multi_first",
  manifest: { filePath: "first" },
  dts: false,
  filename: "first/firstRemoteEntry.js",
  exposes: { "./First": "./src/First.js" },
  shared: {},
};

const secondOptions = {
  name: "vite_multi_second",
  manifest: { filePath: "second" },
  dts: false,
  filename: "second/secondRemoteEntry.js",
  exposes: { "./Second": "./src/Second.js" },
  shared: {},
};

export default defineConfig({
  root,
  plugins: [
    federation(firstOptions),
    federation(secondOptions),
    federationDoctor({
      // The two federation plugins are intentionally left discoverable through
      // Vite's resolved plugin list; this is the adapter contract under test.
      rules: {
        "artifact/types-missing": "off",
        "artifact/dts-disabled": "off",
      },
    }),
  ],
  build: { target: "esnext" },
});
