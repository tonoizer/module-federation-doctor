import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/vite.ts",
    "src/rspack.ts",
    "src/rsbuild.ts",
    "src/webpack.ts",
    "src/rules.ts",
    "src/policy.ts",
  ],
  format: ["esm"],
  outDir: "dist",
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  dts: true,
  clean: true,
  sourcemap: true,
});
