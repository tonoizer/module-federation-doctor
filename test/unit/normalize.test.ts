import { describe, expect, it } from "vitest";
import {
  defaultManifestEnabled,
  normalizeModuleFederation,
  packageName,
} from "../../src/normalize.js";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";

describe("normalization", () => {
  it("normalizes string and object forms in stable order", () => {
    expect(
      normalizeModuleFederation({
        name: "app",
        exposes: { "./Z": "./z.ts", "./A": { import: "./a.ts" } },
        remotes: {
          shop: "shop@https://example.test/remoteEntry.js",
          cart: { entry: "cart@/remoteEntry.js", shareScope: "cart" },
        },
        shared: {
          react: { singleton: true, requiredVersion: "^19.0.0" },
          "react-dom": "^19.0.0",
        },
      }),
    ).toMatchSnapshot();
  });

  it("normalizes runtime plugin tuples to their plugin paths", () => {
    expect(
      normalizeModuleFederation({
        runtimePlugins: [["@module-federation/retry-plugin", { retries: 2 }]],
      })?.runtimePlugins,
    ).toEqual(["@module-federation/retry-plugin"]);
  });

  it("understands scoped packages and deep imports", () => {
    expect(packageName("@scope/pkg/deep")).toBe("@scope/pkg");
    expect(packageName("react/jsx-runtime")).toBe("react");
  });

  it("defaults omitted manifest by bundler family", () => {
    expect(defaultManifestEnabled("webpack")).toBe(true);
    expect(defaultManifestEnabled("rspack")).toBe(true);
    expect(defaultManifestEnabled("rsbuild")).toBe(true);
    expect(defaultManifestEnabled("modern")).toBe(true);
    expect(defaultManifestEnabled("vite")).toBe(false);
    expect(defaultManifestEnabled("unknown")).toBe(false);
    expect(
      normalizeModuleFederation({ name: "host" }, { bundler: "webpack" })?.manifest?.enabled,
    ).toBe(true);
    expect(
      normalizeModuleFederation({ name: "host" }, { bundler: "vite" })?.manifest?.enabled,
    ).toBe(false);
    expect(
      normalizeModuleFederation({ name: "host", manifest: false }, { bundler: "webpack" })?.manifest
        ?.enabled,
    ).toBe(false);
  });

  it("preserves bridge options on NormalizedMFConfig", () => {
    const normalized = normalizeModuleFederation({
      name: "host",
      bridge: { enableBridgeRouter: true, disableAlias: false },
    });
    expect(normalized?.bridge).toEqual({ enableBridgeRouter: true, disableAlias: false });
    expect(normalizeModuleFederation({ name: "host" })?.bridge).toBeUndefined();
  });
});

describe("artifact/manifest-disabled evidence", () => {
  async function runRule(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "artifact/manifest-disabled")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  const base = (): ProjectFacts => ({
    schemaVersion: 1,
    project: { name: "fixture", root: "." },
    bundler: { name: "webpack", mode: "ci" },
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
      exposes: { "./Widget": "src/Widget.ts" },
      remotes: {},
      shared: {},
      manifest: { enabled: false, options: {} },
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

  it("does not fire when manifest artifact was collected", async () => {
    const facts = base();
    facts.capabilities.manifest = true;
    facts.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      exposes: [],
      shared: [],
    };
    expect(await runRule(facts)).toHaveLength(0);
  });

  it("fires for Vite omit without emit", async () => {
    const facts = base();
    facts.bundler.name = "vite";
    expect(await runRule(facts)).not.toHaveLength(0);
  });
});
