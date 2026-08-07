import { defineConfig } from "tsdown";

const entries = [
  "src/index.ts",
  "src/cli.ts",
  "src/vite.ts",
  "src/nuxt.ts",
  "src/rspack.ts",
  "src/rsbuild.ts",
  "src/webpack.ts",
  "src/modern.ts",
  "src/rules.ts",
  "src/policy.ts",
  "src/capture.ts",
];

const common = {
  outDir: "dist",
  sourcemap: true,
};

export default defineConfig([
  {
    ...common,
    entry: entries,
    format: "esm",
    outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
    dts: true,
    clean: true,
  },
  {
    ...common,
    entry: entries.filter((entry) => entry !== "src/cli.ts"),
    format: "cjs",
    outExtensions: () => ({ js: ".cjs", dts: ".d.cts" }),
    dts: true,
    clean: false,
  },
]);
