import path from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { pluginModuleFederationDoctor } from "@module-federation/doctor/modern";
import { mfOptions } from "./modern.config.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Collect plugins the same way Modern.js `modifyBundlerChain` does. */
const plugins = [new ModuleFederationPlugin(mfOptions)];
const chain = {
  plugin(_name) {
    return {
      use(plugin) {
        plugins.push(plugin);
        return this;
      },
    };
  },
};

const doctor = pluginModuleFederationDoctor({
  moduleFederation: mfOptions,
  rules: {
    // Smoke focuses on adapter wiring, not DTS generation.
    "artifact/types-missing": "off",
    // Simulated smoke uses enhanced/rspack under the hood (not @module-federation/modern-js).
    "config/plugin-package-mismatch": "off",
  },
});
await doctor.setup({
  getAppContext: () => ({ bundlerType: "rspack", appDirectory: root }),
  modifyBundlerChain(handler) {
    return handler(chain);
  },
});

const compiler = rspack({
  mode: "production",
  context: root,
  entry: "./src/index.js",
  output: {
    path: path.join(root, "dist"),
    publicPath: "auto",
    uniqueName: "modern_smoke",
    clean: true,
  },
  plugins,
});

await new Promise((resolve, reject) => {
  compiler.run((error, stats) => {
    if (error) {
      reject(error);
      return;
    }
    if (stats?.hasErrors()) {
      reject(new Error(stats.toString({ colors: false, errors: true })));
      return;
    }
    compiler.close((closeError) => {
      if (closeError) reject(closeError);
      else resolve(undefined);
    });
  });
});
