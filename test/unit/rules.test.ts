import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "../../src/rules.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";

const roots: string[] = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-rule-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { react: "19.1.1", "@module-federation/vite": "2.8.0" },
    }),
  );
  await fs.writeFile(path.join(root, "src/index.ts"), 'import "react";\n');
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("built-in rules", () => {
  it("applies demo and production overlays to real findings", async () => {
    const root = await fixture();
    const moduleFederation = {
      name: "host",
      exposes: { "./Widget": "./src/index.ts" },
      remotes: {
        shop: {
          name: "shop",
          entry: "shop@http://localhost:3001/remoteEntry.js",
          shareScope: "default" as const,
        },
      },
      manifest: false,
      dts: false,
      shareStrategy: "version-first" as const,
    };

    const demo = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      extends: ["recommended", "demo"],
      moduleFederation,
      output: { formats: [] },
    });
    expect(
      demo.report.findings.find((item) => item.ruleId === "config/remote-manifest-recommended"),
    ).toBe(undefined);
    expect(
      demo.report.findings.find(
        (item) => item.ruleId === "reliability/version-first-offline-remotes",
      ),
    ).toBe(undefined);
    expect(demo.report.findings.find((item) => item.ruleId === "artifact/manifest-disabled")).toBe(
      undefined,
    );
    expect(
      demo.report.findings.find((item) => item.ruleId === "artifact/dts-disabled"),
    ).toMatchObject({ severity: "info" });

    const production = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      extends: ["recommended", "production"],
      moduleFederation,
      output: { formats: [] },
    });
    for (const ruleId of [
      "config/remote-manifest-recommended",
      "reliability/version-first-offline-remotes",
      "artifact/manifest-disabled",
      "artifact/dts-disabled",
    ]) {
      expect(
        production.report.findings.find((item) => item.ruleId === ruleId),
        ruleId,
      ).toMatchObject({
        severity: "warning",
      });
    }
  });

  it("registers every production rule exactly once", () => {
    const ids = [
      ...builtInRules.map((item) => item.meta.id),
      ...federationRuleMeta.map((item) => item.id),
      ...runtimeRuleMeta.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toMatchSnapshot();
  });

  it("does not register the synthetic external-conflict rule", () => {
    expect(builtInRules.find((rule) => rule.meta.id === "config/shared-externals-conflict")).toBe(
      undefined,
    );
  });

  it("finds invalid config, removes duplicate findings, and honors overrides", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "",
        exposes: { bad: "./missing.ts" },
        shared: { react: { singleton: false, eager: true } },
      },
      rules: {
        "config/name-required": "off",
        "shared/singleton-risk": "info",
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.report.findings.map((item) => [item.ruleId, item.severity])).toContainEqual([
      "shared/singleton-risk",
      "info",
    ]);
    expect(result.report.findings.some((item) => item.ruleId === "config/name-required")).toBe(
      false,
    );
    expect(new Set(result.report.findings.map((item) => item.fingerprint)).size).toBe(
      result.report.findings.length,
    );
  });

  it("accepts a version-only remote resolved through a manifest service", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "rspack",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        manifest: true,
        remotes: { shop: { name: "shop", version: "1.2.3" } },
      },
      rules: {
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "config/plugin-package-mismatch": "off",
        "doctor/partial-analysis": "off",
      },
    });
    expect(result.report.findings.map((finding) => finding.ruleId)).not.toContain(
      "config/remote-entry-invalid",
    );
  });

  it("softens only local demo remote noise through the demo policy pack", async () => {
    const root = await fixture();
    const local = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      extends: ["recommended", "demo"],
      moduleFederation: {
        name: "demo-host",
        shareStrategy: "version-first",
        remotes: { shop: { name: "shop", entry: "shop@remoteEntry.js" } },
      },
      rules: { "config/plugin-package-mismatch": "off", "doctor/partial-analysis": "off" },
    });
    expect(local.report.findings.map((finding) => finding.ruleId)).not.toContain(
      "config/remote-manifest-recommended",
    );
    expect(local.report.findings.map((finding) => finding.ruleId)).not.toContain(
      "reliability/version-first-offline-remotes",
    );

    const external = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      output: { formats: [] },
      extends: ["recommended", "demo"],
      moduleFederation: {
        name: "demo-host",
        shareStrategy: "version-first",
        remotes: { shop: { name: "shop", entry: "shop@https://cdn.example.test/remoteEntry.js" } },
      },
      rules: { "config/plugin-package-mismatch": "off", "doctor/partial-analysis": "off" },
    });
    expect(external.report.findings.map((finding) => finding.ruleId)).toContain(
      "config/remote-manifest-recommended",
    );
    expect(external.report.findings.map((finding) => finding.ruleId)).toContain(
      "reliability/version-first-offline-remotes",
    );

    const ci = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      extends: ["recommended", "demo"],
      moduleFederation: {
        name: "demo-host",
        shareStrategy: "version-first",
        remotes: { shop: { name: "shop", entry: "shop@http://localhost:3001/remoteEntry.js" } },
      },
      rules: { "config/plugin-package-mismatch": "off", "doctor/partial-analysis": "off" },
    });
    expect(ci.report.findings.map((finding) => finding.ruleId)).toContain(
      "config/remote-manifest-recommended",
    );
    expect(ci.report.findings.map((finding) => finding.ruleId)).toContain(
      "reliability/version-first-offline-remotes",
    );
  });

  it("reports oversized federation assets and honors budget overrides", async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "dist/remoteEntry.js"), Buffer.alloc(600_000));
    await fs.writeFile(path.join(root, "dist/Widget.js"), Buffer.alloc(10_000));
    await fs.writeFile(
      path.join(root, "dist/mf-manifest.json"),
      JSON.stringify({
        id: "fixture",
        name: "fixture",
        metaData: {
          publicPath: "auto",
          remoteEntry: { name: "remoteEntry.js", path: "", type: "module" },
        },
        shared: [],
        remotes: [],
        exposes: [
          {
            id: "fixture:Widget",
            name: "Widget",
            path: "./Widget",
            assets: { js: { sync: ["Widget.js"], async: [] }, css: { sync: [], async: [] } },
          },
        ],
      }),
    );

    const failing = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: { name: "fixture", exposes: { "./Widget": "./src/index.ts" } },
      rules: {
        "doctor/partial-analysis": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/remote-entry-missing": "off",
        "config/plugin-package-mismatch": "off",
      },
    });
    expect(failing.facts.artifacts.assetSizes?.["remoteEntry.js"]).toBe(600_000);
    expect(
      failing.report.findings.some(
        (finding) =>
          finding.ruleId === "performance/asset-budget" &&
          finding.evidence["class"] === "remoteEntry",
      ),
    ).toBe(true);

    const overridden = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: { name: "fixture", exposes: { "./Widget": "./src/index.ts" } },
      rules: {
        "doctor/partial-analysis": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/remote-entry-missing": "off",
        "config/plugin-package-mismatch": "off",
        "performance/asset-budget": ["warning", { remoteEntryMaxBytes: 700_000 }],
      },
    });
    expect(
      overridden.report.findings.some((finding) => finding.ruleId === "performance/asset-budget"),
    ).toBe(false);

    const disabled = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: { name: "fixture", exposes: { "./Widget": "./src/index.ts" } },
      rules: {
        "doctor/partial-analysis": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/remote-entry-missing": "off",
        "config/plugin-package-mismatch": "off",
        "performance/asset-budget": "off",
      },
    });
    expect(
      disabled.report.findings.some((finding) => finding.ruleId === "performance/asset-budget"),
    ).toBe(false);
  });

  const behaviorCases: Array<[string, (facts: ProjectFacts) => void]> = [
    ["config/name-required", (facts: ProjectFacts) => (facts.moduleFederation!.name = "")],
    [
      "config/expose-key-invalid",
      (facts: ProjectFacts) => (facts.moduleFederation!.exposes = { Widget: "src/Widget.ts" }),
    ],
    [
      "config/expose-path-missing",
      (facts: ProjectFacts) => (facts.moduleFederation!.exposes = { "./Widget": "src/missing.ts" }),
    ],
    [
      "config/remote-entry-invalid",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.remotes = {
          shop: { name: "shop", entry: "bad", shareScope: "default" },
        }),
    ],
    [
      "config/filename-invalid",
      (facts: ProjectFacts) => (facts.moduleFederation!.filename = "../remoteEntry.txt"),
    ],
    [
      "config/remote-http-insecure",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "shop@http://example.test/remoteEntry.js",
            shareScope: "default",
          },
        }),
    ],
    [
      "config/remote-localhost-in-production",
      (facts: ProjectFacts) => {
        facts.bundler.mode = "ci";
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "http://localhost:3001/remoteEntry.js",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "config/duplicate-plugin-registration",
      (facts: ProjectFacts) => {
        facts.bundler.moduleFederationPluginCount = 2;
      },
    ],
    [
      "config/remote-alias-prefix-collision",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.remotes = {
          scope: {
            name: "@scope/component",
            entry: "https://example.test/a/mf-manifest.json",
            alias: "@scope",
            shareScope: "default",
          },
          other: {
            name: "@scope/other",
            entry: "https://example.test/b/mf-manifest.json",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "config/dts-output-dir-mismatch",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.filename = "static/js/remoteEntry.js";
        facts.moduleFederation!.dts = {
          enabled: true,
          options: { generateTypes: { outputDir: "dist/types" } },
        };
      },
    ],
    [
      "artifact/public-path-non-string-manifest",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.manifest = { enabled: true, options: {} };
        facts.bundler.outputPublicPathKind = "non-string";
      },
    ],
    [
      "config/remote-manifest-recommended",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "shop@https://example.test/remoteEntry.js",
            shareScope: "default",
          },
        }),
    ],
    [
      "config/library-remote-type-mismatch",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.library = { type: "module" };
        facts.moduleFederation!.remoteType = "script";
      },
    ],
    [
      "config/share-scope-undeclared",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shareScope = ["default"];
        facts.moduleFederation!.shared.react!.shareScope = "isolated";
      },
    ],
    [
      "config/runtime-plugin-missing",
      (facts: ProjectFacts) => (facts.moduleFederation!.runtimePlugins = ["./missing-plugin"]),
    ],
    [
      "config/get-public-path-invalid",
      (facts: ProjectFacts) => (facts.moduleFederation!.getPublicPath = "window.cdn"),
    ],
    [
      "config/get-public-path-unused",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.getPublicPath = "function () { return '/'; }"),
    ],
    [
      "security/get-public-path-dynamic-code",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.getPublicPath = "function () { return '/'; }"),
    ],
    [
      "config/implementation-suspicious",
      (facts: ProjectFacts) => (facts.moduleFederation!.implementation = "custom-runtime"),
    ],
    [
      "config/external-runtime-with-exposes",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: true,
        };
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
      },
    ],
    [
      "config/external-runtime-conflict",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: true,
          provideExternalRuntime: true,
        }),
    ],
    [
      "config/remote-capability-disabled",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          disableRemote: true,
          ssrExternals: [],
        };
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "config/shared-capability-disabled",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          disableShared: true,
          ssrExternals: [],
        }),
    ],
    [
      "reliability/snapshot-capability-disabled",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          disableSnapshot: true,
          ssrExternals: [],
        };
        facts.moduleFederation!.manifest = { enabled: true, options: {} };
      },
    ],
    [
      "config/eager-tree-shaking-conflict",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared.react!.eager = true;
        facts.moduleFederation!.shared.react!.treeShaking = { mode: "runtime-infer" };
      },
    ],
    [
      "reliability/external-runtime-provider-unverified",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: true,
          provideExternalRuntime: false,
        }),
    ],
    [
      "reliability/async-startup-library-promise",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.experiments = {
          asyncStartup: true,
          externalRuntime: false,
          provideExternalRuntime: false,
        };
        facts.moduleFederation!.library = { type: "umd" };
      },
    ],
    [
      "performance/version-first-startup",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shareStrategy = "version-first";
        facts.moduleFederation!.remotes = Object.fromEntries(
          ["a", "b", "c"].map((name) => [
            name,
            { name, entry: `https://example.test/${name}/mf-manifest.json`, shareScope: "default" },
          ]),
        );
      },
    ],
    [
      "performance/asset-budget",
      (facts: ProjectFacts) => {
        facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          remoteEntry: { name: "remoteEntry.js", path: "" },
          exposes: [{ key: "./Widget", assets: ["Widget.js"] }],
          shared: [{ name: "react", assets: ["__federation_shared_react.js"] }],
        };
        facts.artifacts.assetSizes = {
          "remoteEntry.js": 600_000,
          "Widget.js": 10_000,
          "__federation_shared_react.js": 10_000,
        };
      },
    ],
    [
      "reliability/version-first-offline-remotes",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shareStrategy = "version-first";
        facts.moduleFederation!.runtimePlugins = [];
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "reliability/shared-import-false",
      (facts: ProjectFacts) => (facts.moduleFederation!.shared.react!.import = false),
    ],
    [
      "config/tree-shaking-server-calc-injection",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.treeShaking = {
          injectUsedExports: true,
          plugins: [],
          excludePlugins: [],
        };
        facts.moduleFederation!.shared.react!.treeShaking = { mode: "server-calc" };
      },
    ],
    [
      "reliability/tree-shaking-server-calc-contract",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.treeShaking = { plugins: [], excludePlugins: [] };
        facts.moduleFederation!.shared.react!.treeShaking = { mode: "server-calc" };
      },
    ],
    [
      "performance/vite-bundle-all-css",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.vite = {
          bundleAllCSS: true,
          ignoreOrigin: false,
          ssrExternals: [],
        };
        facts.moduleFederation!.exposes = { "./A": "src/Widget.ts", "./B": "src/Widget.ts" };
      },
    ],
    [
      "reliability/vite-fixed-parse-timeout",
      (facts: ProjectFacts) =>
        (facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: [],
          moduleParseTimeout: 10,
        }),
    ],
    [
      "vite/remotes-prefer-module",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
            shareScope: ["default"],
          },
        };
      },
    ],
    [
      "vite/var-filename-interop",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: [],
          varFilename: "remoteEntry.js",
        };
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
            shareScope: ["default"],
          },
        };
      },
    ],
    [
      "vite/host-init-inject-ssr",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: [],
          hostInitInjectLocation: "html",
          target: "node",
        };
      },
    ],
    [
      "vite/ssr-nitro-externals",
      (facts: ProjectFacts) => {
        facts.dependencies.declared.nitropack = "^2";
        facts.moduleFederation!.shared.react = {
          package: "react",
          singleton: true,
          eager: false,
          shareScope: "default",
        };
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: ["react"],
          ssrEntryLoader: "virtual:mf-ssr-entry",
        };
      },
    ],
    [
      "vite/manual-chunks-conflict",
      (facts: ProjectFacts) => {
        facts.bundler.viteConfig = { manualChunks: true };
      },
    ],
    [
      "vite/hashed-remote-filename",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.filename = "remoteEntry.[hash].js";
      },
    ],
    [
      "vite/remote-hmr-dev",
      (facts: ProjectFacts) => {
        facts.bundler.mode = "development";
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: [],
          remoteHmr: false,
        };
      },
    ],
    [
      "vite/alias-share-bypass",
      (facts: ProjectFacts) => {
        facts.bundler.viteConfig = { resolveAliases: { react: "./src/shims/react.ts" } };
        facts.moduleFederation!.shared.react = {
          package: "react",
          singleton: true,
          eager: false,
          shareScope: "default",
        };
      },
    ],
    [
      "vite/server-origin",
      (facts: ProjectFacts) => {
        facts.bundler.viteConfig = { serverOrigin: null };
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
            type: "module",
            shareScope: ["default"],
          },
        };
      },
    ],
    [
      "config/transform-import-share-conflict",
      (facts: ProjectFacts) => {
        facts.bundler.transformImportLibraries = ["lodash"];
        facts.moduleFederation!.shared = {
          lodash: { package: "lodash", singleton: false, eager: false, shareScope: ["default"] },
        };
      },
    ],
    [
      "artifact/manifest-assets-disabled",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.manifest = {
          enabled: true,
          options: { disableAssetsAnalyze: true },
        };
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
      },
    ],
    [
      "artifact/manifest-disabled",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.manifest = { enabled: false, options: {} };
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
        facts.capabilities.manifest = false;
        delete facts.artifacts.manifest;
      },
    ],
    [
      "artifact/dts-disabled",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.dts = { enabled: false, options: {} };
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
      },
    ],
    [
      "shared/version-unsatisfied",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared.react!.requiredVersion = "^18";
        facts.dependencies.installed.react = "19.1.1";
      },
    ],
    [
      "artifact/manifest-invalid",
      (facts: ProjectFacts) =>
        (facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: false,
          exposes: [],
          shared: [],
        }),
    ],
    [
      "artifact/manifest-name-mismatch",
      (facts: ProjectFacts) =>
        (facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          name: "other",
          exposes: [],
          shared: [],
        }),
    ],
    [
      "artifact/manifest-remote-entry-missing",
      (facts: ProjectFacts) => {
        facts.capabilities.emittedAssets = true;
        facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          remoteEntry: { name: "remoteEntry.js", path: "" },
          exposes: [],
          shared: [],
        };
      },
    ],
    [
      "artifact/manifest-expose-assets-empty",
      (facts: ProjectFacts) => {
        facts.bundler.name = "webpack";
        facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          exposes: [{ key: "./Widget", assets: [] }],
          shared: [],
        };
      },
    ],
    [
      "artifact/manifest-shared-version-mismatch",
      (facts: ProjectFacts) =>
        (facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          exposes: [],
          shared: [{ name: "react", version: "18.3.0", assets: [] }],
        }),
    ],
    [
      "artifact/types-metadata-missing",
      (facts: ProjectFacts) =>
        (facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          exposes: [{ key: "./Widget", assets: ["Widget.js"] }],
          shared: [],
        }),
    ],
    [
      "artifact/remote-entry-missing",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
        facts.capabilities.emittedAssets = true;
      },
    ],
    [
      "artifact/expose-missing",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
        facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          exposes: [],
          shared: [],
        };
      },
    ],
    [
      "doctor/partial-analysis",
      (facts: ProjectFacts) => {
        facts.capabilities.manifest = false;
      },
    ],
    [
      "config/plugin-package-mismatch",
      (facts: ProjectFacts) => {
        facts.dependencies.declared = {};
      },
    ],
    [
      "shared/singleton-risk",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared.react!.singleton = false;
      },
    ],
    [
      "shared/eager-without-singleton",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared.react = {
          package: "react",
          singleton: false,
          eager: true,
          shareScope: "default",
        };
      },
    ],
    [
      "shared/unused",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared = {
          lodash: {
            package: "lodash",
            singleton: false,
            eager: false,
            shareScope: "default",
          },
        };
        facts.imports.packages = [];
      },
    ],
    [
      "shared/candidate",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared = {};
        facts.imports.packages = ["react"];
      },
    ],
    [
      "shared/react-host-missing",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.remotes = {
          remote: {
            name: "remote",
            entry: "https://example.test/remote.js",
            shareScope: "default",
          },
        };
        facts.moduleFederation!.shared = {};
        facts.imports.packages = ["react"];
      },
    ],
    [
      "shared/deep-import-bypass",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared = {
          lodash: {
            package: "lodash",
            singleton: false,
            eager: false,
            shareScope: "default",
          },
        };
        facts.imports.specifiers = ["lodash/cloneDeep"];
        facts.imports.packages = ["lodash"];
        facts.imports.deepImports = ["lodash/cloneDeep"];
        facts.imports.deepImportFiles = { lodash: ["src/Widget.ts"] };
      },
    ],
    [
      "artifact/public-path-suspicious",
      (facts: ProjectFacts) =>
        (facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          publicPath: "assets",
          exposes: [],
          shared: [],
        }),
    ],
    [
      "artifact/types-missing",
      (facts: ProjectFacts) => {
        facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          exposes: [{ key: "./Widget", assets: ["Widget.js"] }],
          shared: [],
        };
      },
    ],
    [
      "bridge/react-version-entry-prefer",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["react", "@module-federation/bridge-react"];
        facts.imports.specifiers = ["react", "@module-federation/bridge-react"];
        facts.moduleFederation!.runtimePlugins = ["@module-federation/bridge-react/plugin"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
          "react-dom/": {
            package: "react-dom/",
            singleton: true,
            eager: false,
            shareScope: "default",
          },
        };
      },
    ],
    [
      "bridge/react-dom-prefix-missing",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["react", "@module-federation/bridge-react"];
        facts.imports.specifiers = ["react", "@module-federation/bridge-react/v19"];
        facts.moduleFederation!.runtimePlugins = ["@module-federation/bridge-react/plugin"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
        };
      },
    ],
    [
      "bridge/lazy-plugin-unregistered",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["react", "@module-federation/bridge-react"];
        facts.imports.specifiers = ["react", "@module-federation/bridge-react/v19"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
          "react-dom/": {
            package: "react-dom/",
            singleton: true,
            eager: false,
            shareScope: "default",
          },
        };
      },
    ],
    [
      "bridge/router-implicit-enable",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["react", "@module-federation/bridge-react"];
        facts.imports.specifiers = ["react", "@module-federation/bridge-react/v19"];
        facts.moduleFederation!.runtimePlugins = ["@module-federation/bridge-react/plugin"];
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
          "react-dom/": {
            package: "react-dom/",
            singleton: true,
            eager: false,
            shareScope: "default",
          },
        };
      },
    ],
    [
      "bridge/router-shared-conflict",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["react", "@module-federation/bridge-react"];
        facts.imports.specifiers = ["react", "@module-federation/bridge-react/v19"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.runtimePlugins = ["@module-federation/bridge-react/plugin"];
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
          "react-dom/": {
            package: "react-dom/",
            singleton: true,
            eager: false,
            shareScope: "default",
          },
          "react-router-dom": {
            package: "react-router-dom",
            singleton: true,
            eager: false,
            shareScope: "default",
          },
        };
      },
    ],
    [
      "bridge/react-version-entry-mismatch",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.dependencies.declared.react = "^19";
        facts.dependencies.installed.react = "19.1.1";
        facts.imports.packages = ["react", "@module-federation/bridge-react"];
        facts.imports.specifiers = ["react", "@module-federation/bridge-react/v18"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.runtimePlugins = ["@module-federation/bridge-react/plugin"];
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
          "react-dom/": {
            package: "react-dom/",
            singleton: true,
            eager: false,
            shareScope: "default",
          },
        };
      },
    ],
    [
      "bridge/provider-shape-invalid",
      (facts: ProjectFacts) => {
        const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "mfdoctor-bridge-shape-"));
        fsSync.mkdirSync(path.join(root, "src"));
        fsSync.writeFileSync(
          path.join(root, "src/App.tsx"),
          [
            'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
            "export const Remote = createRemoteAppComponent({});",
            "",
          ].join("\n"),
        );
        facts.project.root = root;
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.sourceFiles = ["src/App.tsx"];
        facts.imports.packages = ["react", "@module-federation/bridge-react"];
        facts.imports.specifiers = ["react", "@module-federation/bridge-react/v19"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.runtimePlugins = ["@module-federation/bridge-react/plugin"];
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
          "react-dom/": {
            package: "react-dom/",
            singleton: true,
            eager: false,
            shareScope: "default",
          },
        };
      },
    ],
    [
      "bridge/ssr-server-entry-leak",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["react", "@module-federation/bridge-react"];
        facts.imports.specifiers = ["react", "@module-federation/bridge-react/v19"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.runtimePlugins = ["@module-federation/bridge-react/plugin"];
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          target: "node",
          ssrExternals: [],
        };
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
          "react-dom/": {
            package: "react-dom/",
            singleton: true,
            eager: false,
            shareScope: "default",
          },
        };
      },
    ],
    [
      "bridge/missing-fallback-loading",
      (facts: ProjectFacts) => {
        const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "mfdoctor-bridge-fallback-"));
        fsSync.mkdirSync(path.join(root, "src"));
        fsSync.writeFileSync(
          path.join(root, "src/App.tsx"),
          [
            'import { createRemoteAppComponent } from "@module-federation/bridge-react/v19";',
            "export const Remote = createRemoteAppComponent({ loader: async () => ({ default: () => null }) });",
            "",
          ].join("\n"),
        );
        facts.project.root = root;
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.sourceFiles = ["src/App.tsx"];
        facts.imports.packages = ["@module-federation/bridge-react"];
        facts.imports.specifiers = ["@module-federation/bridge-react/v19"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
      },
    ],
    [
      "bridge/consumer-api-manual",
      (facts: ProjectFacts) => {
        const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "mfdoctor-bridge-manual-"));
        fsSync.mkdirSync(path.join(root, "src"));
        fsSync.writeFileSync(
          path.join(root, "src/App.tsx"),
          'import { loadRemote } from "@module-federation/runtime";\nloadRemote("shop/App");\n',
        );
        facts.project.root = root;
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.sourceFiles = ["src/App.tsx"];
        facts.imports.packages = ["@module-federation/bridge-react", "@module-federation/runtime"];
        facts.imports.specifiers = [
          "@module-federation/bridge-react/v19",
          "@module-federation/runtime",
        ];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "bridge/export-app-missing",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["@module-federation/bridge-react"];
        facts.imports.specifiers = ["@module-federation/bridge-react/v19"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.tsx" };
      },
    ],
    [
      "bridge/ssr-instanceid-hydration",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["@module-federation/bridge-react"];
        facts.imports.specifiers = ["@module-federation/bridge-react/server"];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          target: "node",
          ssrExternals: [],
        };
      },
    ],
    [
      "bridge/tanstack-router-conflict",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.dependencies.declared["@tanstack/react-router"] = "1.0.0";
        facts.imports.packages = ["@module-federation/bridge-react", "@tanstack/react-router"];
        facts.imports.specifiers = [
          "@module-federation/bridge-react/v19",
          "@tanstack/react-router",
        ];
        facts.moduleFederation!.bridge = { enableBridgeRouter: true };
      },
    ],
    [
      "bridge/disable-alias-deprecated",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
        facts.imports.packages = ["@module-federation/bridge-react"];
        facts.imports.specifiers = ["@module-federation/bridge-react/v19"];
        facts.moduleFederation!.bridge = { disableAlias: true };
      },
    ],
    [
      "bridge/vue-share-missing",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
        facts.dependencies.declared.vue = "3.5.0";
        facts.imports.packages = ["@module-federation/bridge-vue3", "vue"];
        facts.moduleFederation!.shared = {};
      },
    ],
    [
      "bridge/vue-ssr-fresh-context",
      (facts: ProjectFacts) => {
        const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "mfdoctor-vue-ssr-fresh-"));
        fsSync.mkdirSync(path.join(root, "src"));
        fsSync.writeFileSync(
          path.join(root, "src/App.vue"),
          [
            'import { createBridgeComponent } from "@module-federation/bridge-vue3";',
            "export default createBridgeComponent({ rootComponent: {} });",
            "",
          ].join("\n"),
        );
        facts.project.root = root;
        facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
        facts.imports.sourceFiles = ["src/App.vue"];
        facts.imports.packages = ["@module-federation/bridge-vue3"];
        facts.imports.specifiers = ["@module-federation/bridge-vue3"];
        facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: false,
          target: "node",
        };
        facts.moduleFederation!.shared = {
          vue: { package: "vue", singleton: true, eager: false, shareScope: "default" },
        };
      },
    ],
    [
      "bridge/vue-server-entry",
      (facts: ProjectFacts) => {
        facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
        facts.imports.packages = ["@module-federation/bridge-vue3"];
        facts.imports.specifiers = ["@module-federation/bridge-vue3"];
        facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: false,
          target: "node",
        };
        facts.moduleFederation!.shared = {
          vue: { package: "vue", singleton: true, eager: false, shareScope: "default" },
        };
      },
    ],
    [
      "bridge/vue-consumer-manual",
      (facts: ProjectFacts) => {
        const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "mfdoctor-vue-manual-"));
        fsSync.mkdirSync(path.join(root, "src"));
        fsSync.writeFileSync(
          path.join(root, "src/App.ts"),
          'import { loadRemote } from "@module-federation/runtime";\nloadRemote("shop/App");\n',
        );
        facts.project.root = root;
        facts.dependencies.declared["@module-federation/bridge-vue3"] = "0.2.0";
        facts.imports.sourceFiles = ["src/App.ts"];
        facts.imports.packages = ["@module-federation/bridge-vue3", "@module-federation/runtime"];
        facts.imports.specifiers = ["@module-federation/bridge-vue3", "@module-federation/runtime"];
        facts.moduleFederation!.shared = {
          vue: { package: "vue", singleton: true, eager: false, shareScope: "default" },
        };
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "ssr/node-remote-manifest",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: false,
          target: "node",
        };
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "http://localhost:3001/mf-manifest.json",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "ssr/node-runtime-plugin-missing",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: false,
          target: "node",
        };
        facts.moduleFederation!.runtimePlugins = [];
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "http://localhost:3001/ssr/mf-manifest.json",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "ssr/node-library-dts",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: false,
          target: "node",
        };
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.tsx" };
        facts.moduleFederation!.library = { type: "var" };
        facts.moduleFederation!.dts = { enabled: true, options: {} };
      },
    ],
    [
      "runtime-plugins/invalid-factory",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.runtimePlugins = ["./src/bad-plugin.ts"];
        facts.runtimePluginContracts = [
          {
            plugin: "./src/bad-plugin.ts",
            kind: "invalid-factory",
            reason: "non-factory-export",
            file: "src/bad-plugin.ts",
          },
        ];
      },
    ],
    [
      "runtime-plugins/create-script-cors-parity",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.runtimePlugins = ["./src/cors-plugin.ts"];
        facts.runtimePluginContracts = [
          {
            plugin: "./src/cors-plugin.ts",
            kind: "cors-parity",
            reason: "create-script-without-create-link",
            confidence: "clear",
            file: "src/cors-plugin.ts",
          },
        ];
      },
    ],
    [
      "runtime-plugins/create-script-without-link",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.runtimePlugins = ["./src/script-plugin.ts"];
        facts.runtimePluginContracts = [
          {
            plugin: "./src/script-plugin.ts",
            kind: "cors-parity",
            reason: "create-script-without-create-link",
            confidence: "heuristic",
            file: "src/script-plugin.ts",
          },
        ];
      },
    ],
  ];

  it("has a behavior fixture for every local rule", () => {
    expect(behaviorCases.map(([id]) => id).sort()).toEqual(
      builtInRules
        .map((rule) => rule.meta.id)
        .filter(
          (id) =>
            id !== "config/nested-producer-dts-extract" && id !== "config/remote-type-urls-missing",
        )
        .sort(),
    );
  });

  it.each(behaviorCases)("reports the %s behavior", async (id, mutate) => {
    const facts: ProjectFacts = {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: { name: "vite", mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: true,
        stats: true,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "fixture",
        exposes: {},
        remotes: {},
        shared: {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
        },
      },
      dependencies: {
        declared: { react: "^19", "@module-federation/vite": "1.19.1" },
        installed: { react: "19.1.1" },
      },
      imports: {
        sourceFiles: ["src/Widget.ts"],
        specifiers: ["react"],
        packages: ["react"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    };
    mutate(facts);
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find((item) => item.meta.id === id)!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings, id).not.toHaveLength(0);
  });

  it("skips version-first offline remotes when a retry recovery plugin is configured", async () => {
    const facts: ProjectFacts = {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: { name: "vite", mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: true,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "fixture",
        shareStrategy: "version-first",
        runtimePlugins: ["@module-federation/retry-plugin"],
        exposes: {},
        remotes: {
          shop: {
            name: "shop",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        },
        shared: {},
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: [],
      },
      artifacts: { emittedAssets: [] },
    };
    const findings: Array<unknown> = [];
    const selected = builtInRules.find(
      (item) => item.meta.id === "reliability/version-first-offline-remotes",
    )!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toHaveLength(0);
  });

  it.each([
    ["loaded-first", "loaded-first", undefined],
    ["tuple retry plugin", "version-first", ["@module-federation/retry-plugin"]],
    ["Modern shared strategy plugin", "version-first", ["./shared-strategy-plugin"]],
  ])("skips offline remote warning for %s", async (_label, shareStrategy, runtimePlugins) => {
    const facts: ProjectFacts = {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: { name: "modern", mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: true,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "fixture",
        shareStrategy: shareStrategy as "version-first" | "loaded-first",
        ...(runtimePlugins ? { runtimePlugins: runtimePlugins as string[] } : {}),
        exposes: {},
        remotes: {
          shop: {
            name: "shop",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        },
        shared: {},
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: [],
      },
      artifacts: { emittedAssets: [] },
    };
    const findings: Array<unknown> = [];
    const selected = builtInRules.find(
      (item) => item.meta.id === "reliability/version-first-offline-remotes",
    )!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toHaveLength(0);
  });
});

describe("doctor/partial-analysis suggestions", () => {
  async function runPartial(facts: ProjectFacts) {
    const findings: Array<{
      message: string;
      suggestion?: string;
      evidence?: Record<string, unknown>;
    }> = [];
    const rule = builtInRules.find((item) => item.meta.id === "doctor/partial-analysis")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  const baseFacts = (): ProjectFacts => ({
    schemaVersion: 1,
    project: { name: "fixture", root: "." },
    bundler: { name: "vite", mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: {
      name: "fixture",
      exposes: {},
      remotes: {},
      shared: {},
    },
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: { emittedAssets: [] },
  });

  it("suggests Vite manifest opt-in when options exist but artifacts are missing", async () => {
    const findings = await runPartial(baseFacts());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toMatch(/manifest:\s*true/);
    expect(findings[0]?.suggestion).not.toBe("Pass explicit MF options.");
  });

  it("keeps Pass explicit MF options when config capability is missing", async () => {
    const facts = baseFacts();
    facts.capabilities.config = false;
    delete facts.moduleFederation;
    const findings = await runPartial(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toBe("Pass explicit MF options.");
  });
});

describe("config/implementation-suspicious", () => {
  async function runRule(facts: ProjectFacts) {
    const findings: Array<{ message: string; evidence?: Record<string, unknown> }> = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/implementation-suspicious")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  const base = (): ProjectFacts => ({
    schemaVersion: 1,
    project: { name: "fixture", root: "." },
    bundler: { name: "rspack", mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    moduleFederation: {
      name: "fixture",
      exposes: {},
      remotes: {},
      shared: {},
    },
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: { emittedAssets: [] },
  });

  it("skips Doctor [external]/ path rewrites", async () => {
    const facts = base();
    facts.moduleFederation!.implementation = "[external]/bundler.js";
    expect(await runRule(facts)).toHaveLength(0);
  });

  it("still flags custom non-local implementations", async () => {
    const facts = base();
    facts.moduleFederation!.implementation = "custom-runtime";
    expect(await runRule(facts)).not.toHaveLength(0);
  });
});

describe("Vite/Nuxt artifact false positives", () => {
  async function runRule(id: string, facts: ProjectFacts) {
    const findings: Array<{ message: string }> = [];
    const rule = builtInRules.find((item) => item.meta.id === id)!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  const viteBase = (): ProjectFacts => ({
    schemaVersion: 1,
    project: { name: "fixture", root: "." },
    bundler: { name: "vite", mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: true,
      stats: false,
      emittedAssets: true,
      installedVersions: true,
    },
    moduleFederation: {
      name: "fixture",
      exposes: { "./Widget": "src/Widget.ts" },
      remotes: {},
      shared: {},
    },
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: {
      emittedAssets: [],
      assetSizes: { "remoteEntry.js": 1200 },
      manifest: {
        path: "dist/mf-manifest.json",
        valid: true,
        publicPath: "./",
        remoteEntry: { name: "remoteEntry.js", path: "" },
        exposes: [{ key: "./Widget", assets: [] }],
        shared: [],
      },
    },
  });

  it("accepts empty remoteEntry.path when assetSizes lists the entry", async () => {
    expect(await runRule("artifact/manifest-remote-entry-missing", viteBase())).toHaveLength(0);
  });

  it("still flags non-empty remoteEntry.path missing from emit and exact sizes", async () => {
    const facts = viteBase();
    facts.artifacts.manifest!.remoteEntry = { name: "remoteEntry.js", path: "assets/" };
    facts.artifacts.assetSizes = { "remoteEntry.js": 1200 };
    expect(await runRule("artifact/manifest-remote-entry-missing", facts)).not.toHaveLength(0);
  });

  it("allows relative ./ publicPath", async () => {
    expect(await runRule("artifact/public-path-suspicious", viteBase())).toHaveLength(0);
  });

  it("skips all-empty Vite expose asset lists", async () => {
    expect(await runRule("artifact/manifest-expose-assets-empty", viteBase())).toHaveLength(0);
  });
});

describe("vite remotes typing dialect", () => {
  function baseFacts(bundler: ProjectFacts["bundler"]["name"] = "vite"): ProjectFacts {
    return {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: { name: bundler, mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {},
        shared: {},
        vite: { bundleAllCSS: false, ignoreOrigin: false, ssrExternals: [] },
      },
      dependencies: { declared: { "@module-federation/vite": "1.19.1" }, installed: {} },
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    };
  }

  async function run(id: string, facts: ProjectFacts, options: Record<string, unknown> = {}) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find((item) => item.meta.id === id)!;
    await selected.check({ facts, options, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("warns on string/default var remotes without varFilename", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "http://localhost:4174/remoteEntry.js",
        shareScope: ["default"],
      },
    };
    expect(await run("vite/remotes-prefer-module", facts)).not.toHaveLength(0);
  });

  it("stays quiet for explicit type module remotes", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "http://localhost:4174/remoteEntry.js",
        type: "module",
        shareScope: ["default"],
      },
    };
    expect(await run("vite/remotes-prefer-module", facts)).toHaveLength(0);
    expect(await run("vite/var-filename-interop", facts)).toHaveLength(0);
  });

  it("stays quiet for explicit global remotes used with webpack/rspack producers", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "http://localhost:4174/remoteEntry.js",
        type: "global",
        shareScope: ["default"],
      },
    };
    expect(await run("vite/remotes-prefer-module", facts)).toHaveLength(0);
  });

  it("honors preferModuleRemotes false and allowVarRemotesWithVarFilename false", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "http://localhost:4174/remoteEntry.js",
        shareScope: ["default"],
      },
    };
    expect(
      await run("vite/remotes-prefer-module", facts, { preferModuleRemotes: false }),
    ).toHaveLength(0);

    facts.moduleFederation!.vite!.varFilename = "remoteEntry.js";
    expect(
      await run("vite/remotes-prefer-module", facts, { allowVarRemotesWithVarFilename: false }),
    ).not.toHaveLength(0);
  });

  it("allows var remotes when varFilename is set and emits interop info", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.vite!.varFilename = "remoteEntry.js";
    facts.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "http://localhost:4174/remoteEntry.js",
        shareScope: ["default"],
      },
    };
    expect(await run("vite/remotes-prefer-module", facts)).toHaveLength(0);
    expect(await run("vite/var-filename-interop", facts)).not.toHaveLength(0);
  });

  it("stays silent on rspack and when remotes facts are missing", async () => {
    const rspack = baseFacts("rspack");
    rspack.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "http://localhost:4174/remoteEntry.js",
        shareScope: ["default"],
      },
    };
    expect(await run("vite/remotes-prefer-module", rspack)).toHaveLength(0);

    const empty = baseFacts();
    expect(await run("vite/remotes-prefer-module", empty)).toHaveLength(0);
    expect(await run("vite/var-filename-interop", empty)).toHaveLength(0);
  });
});

describe("vite SSR inject dialect", () => {
  function baseFacts(): ProjectFacts {
    return {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: { name: "vite", mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {},
        shared: {},
        vite: { bundleAllCSS: false, ignoreOrigin: false, ssrExternals: [] },
      },
      dependencies: { declared: { "@module-federation/vite": "1.19.1" }, installed: {} },
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    };
  }

  async function run(id: string, facts: ProjectFacts, options: Record<string, unknown> = {}) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find((item) => item.meta.id === id)!;
    await selected.check({ facts, options, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("flags SSR Vite with wrong or missing hostInitInjectLocation", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.vite!.target = "node";
    facts.moduleFederation!.vite!.hostInitInjectLocation = "html";
    expect(await run("vite/host-init-inject-ssr", facts)).not.toHaveLength(0);

    delete facts.moduleFederation!.vite!.hostInitInjectLocation;
    expect(await run("vite/host-init-inject-ssr", facts)).not.toHaveLength(0);
  });

  it("stays quiet for SSR with entry inject and for browser-only hosts", async () => {
    const ssr = baseFacts();
    ssr.moduleFederation!.vite!.target = "node";
    ssr.moduleFederation!.vite!.hostInitInjectLocation = "entry";
    expect(await run("vite/host-init-inject-ssr", ssr)).toHaveLength(0);

    const browser = baseFacts();
    expect(await run("vite/host-init-inject-ssr", browser)).toHaveLength(0);
    browser.moduleFederation!.vite!.hostInitInjectLocation = "html";
    expect(await run("vite/host-init-inject-ssr", browser)).toHaveLength(0);

    // Vite default ssr.target often records builds.targetKind=node on client builds.
    browser.builds = [
      {
        id: "client",
        adapter: "vite",
        bundler: "vite",
        outputRoot: "dist",
        sourceHook: "writeBundle",
        target: "node",
        targetKind: "node",
        emittedAssets: [],
        artifacts: [],
        capabilities: {
          outputRoot: { state: "exact", reason: "test" },
          emittedAssets: { state: "exact", reason: "test" },
          artifacts: { state: "unavailable", reason: "test" },
          effectiveMode: { state: "exact", reason: "test" },
          target: { state: "exact", reason: "test" },
        },
      },
    ];
    expect(await run("vite/host-init-inject-ssr", browser)).toHaveLength(0);
  });

  it("warns when Nitro shared React overlaps ssrExternals and skips without facts", async () => {
    const facts = baseFacts();
    facts.dependencies.declared.nitropack = "^2";
    facts.moduleFederation!.shared = {
      react: { package: "react", singleton: true, eager: false, shareScope: ["default"] },
    };
    facts.moduleFederation!.vite!.ssrExternals = ["react"];
    expect(await run("vite/ssr-nitro-externals", facts)).not.toHaveLength(0);

    const missing = baseFacts();
    missing.moduleFederation!.shared = {
      react: { package: "react", singleton: true, eager: false, shareScope: ["default"] },
    };
    expect(await run("vite/ssr-nitro-externals", missing)).toHaveLength(0);
  });
});

describe("vite dialect follow-ons", () => {
  it("skips follow-on rules when plugin viteConfig facts are absent", async () => {
    const facts: ProjectFacts = {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: { name: "vite", mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
            type: "module",
            shareScope: ["default"],
          },
        },
        shared: {
          react: { package: "react", singleton: true, eager: false, shareScope: ["default"] },
        },
        vite: { bundleAllCSS: false, ignoreOrigin: false, ssrExternals: [] },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    };
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    for (const id of [
      "vite/manual-chunks-conflict",
      "vite/alias-share-bypass",
      "vite/server-origin",
    ] as const) {
      findings.length = 0;
      const selected = builtInRules.find((item) => item.meta.id === id)!;
      await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
      expect(findings, id).toHaveLength(0);
    }
  });
});

describe("config/transform-import-share-conflict", () => {
  async function run(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find(
      (item) => item.meta.id === "config/transform-import-share-conflict",
    )!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  function base(): ProjectFacts {
    return {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: { name: "modern", mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {},
        shared: {},
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: [],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
    };
  }

  it("warns on lodash overlap and stays silent without overlap or facts", async () => {
    const overlap = base();
    overlap.bundler.transformImportLibraries = ["lodash"];
    overlap.moduleFederation!.shared = {
      lodash: { package: "lodash", singleton: false, eager: false, shareScope: ["default"] },
    };
    expect(await run(overlap)).not.toHaveLength(0);

    const noOverlap = base();
    noOverlap.bundler.transformImportLibraries = ["lodash"];
    noOverlap.moduleFederation!.shared = {
      react: { package: "react", singleton: true, eager: false, shareScope: ["default"] },
    };
    expect(await run(noOverlap)).toHaveLength(0);

    const missing = base();
    missing.moduleFederation!.shared = {
      lodash: { package: "lodash", singleton: false, eager: false, shareScope: ["default"] },
    };
    expect(await run(missing)).toHaveLength(0);
  });
});
