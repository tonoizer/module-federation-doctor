import { defineConfig } from "vite-plus";

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

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "**/dist/**",
      "**/.mf/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "apps/docs/doc_build/**",
      "apps/docs/docs/rules/**/*.md",
      "apps/docs/docs/api.md",
      "fixtures/manifests/malformed.json",
      "pnpm-lock.yaml",
      ".agents/**",
      ".claude/skills/**",
    ],
    sortPackageJson: false,
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/.mf/**",
      "**/coverage/**",
      "apps/docs/doc_build/**",
      ".agents/**",
      ".claude/skills/**",
    ],
    categories: {
      correctness: "error",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "no-await-in-loop": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/require-module-specifiers": "off",
    },
  },
  pack: [
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
  ],
});
