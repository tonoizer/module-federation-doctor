import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";
import { builtInRules, federationRuleMeta } from "../../src/rules.js";
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
  it("registers every production rule exactly once", () => {
    const ids = [
      ...builtInRules.map((item) => item.meta.id),
      ...federationRuleMeta.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toMatchSnapshot();
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
      "config/shared-externals-conflict",
      (facts: ProjectFacts) => (facts.dependencies.declared["doctor:externals"] = "react"),
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
      (facts: ProjectFacts) =>
        (facts.artifacts.manifest = {
          path: "dist/mf-manifest.json",
          valid: true,
          exposes: [{ key: "./Widget", assets: [] }],
          shared: [],
        }),
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
  ];

  it("has a behavior fixture for every local rule", () => {
    expect(behaviorCases.map(([id]) => id).sort()).toEqual(
      builtInRules.map((rule) => rule.meta.id).sort(),
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
      imports: { sourceFiles: ["src/Widget.ts"], specifiers: ["react"], packages: ["react"] },
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
});
