import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";
import { readCanonicalModuleFederationConfig } from "../../src/canonical-config.js";
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
  it("applies production overlay warnings after demo-only behavior is removed", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      extends: ["recommended", "demo", "production"],
      moduleFederation: {
        name: "host",
        remotes: { shop: { name: "shop", entry: "shop@http://localhost:3001/remoteEntry.js" } },
        shareStrategy: "version-first",
      },
      output: { formats: [] },
    });
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "config/remote-manifest-recommended",
          severity: "warning",
        }),
        expect.objectContaining({
          ruleId: "reliability/version-first-offline-remotes",
          severity: "warning",
        }),
      ]),
    );
  });
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

  it("runs shared rules when bundler is unknown and still skips Vite-only rules", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "unknown",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "",
        remotes: {
          shop: { name: "shop", entry: "http://localhost:4174/remoteEntry.js" },
        },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "artifact/remote-entry-missing": "off",
      },
    });
    const ids = result.report.findings.map((item) => item.ruleId);
    expect(ids).toContain("config/name-required");
    expect(ids).not.toContain("vite/remotes-prefer-module");
  });

  it("accepts the Vite/Core root expose key and extensionless expose paths", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "fixture",
        exposes: { ".": "./src/index" },
      },
      rules: {
        "config/plugin-package-mismatch": "off",
        "doctor/partial-analysis": "off",
      },
    });
    expect(result.report.findings.map((item) => item.ruleId)).not.toContain(
      "config/expose-key-invalid",
    );
    expect(result.report.findings.map((item) => item.ruleId)).not.toContain(
      "config/expose-path-missing",
    );
  });

  it("uses the public expose list for config/expose-key-invalid", async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, "src/Widget.ts"), "export default 1;\n");
    const withImport = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "fixture",
        exposes: {
          Widget: { import: "./src/Widget.ts", filter: { request: "./secret" } },
        },
      },
      rules: {
        "config/plugin-package-mismatch": "off",
        "doctor/partial-analysis": "off",
      },
    });
    expect(withImport.report.findings.map((item) => item.ruleId)).toContain(
      "config/expose-key-invalid",
    );
    expect(withImport.facts.canonicalConfig?.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/exposes/Widget/filter",
          reason: "extension",
        }),
      ]),
    );

    const withoutImport = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "fixture",
        exposes: {
          Widget: { dontExpose: true },
          "./Real": "./src/index.ts",
        },
      },
      rules: {
        "config/plugin-package-mismatch": "off",
        "doctor/partial-analysis": "off",
      },
    });
    expect(withoutImport.report.findings.map((item) => item.ruleId)).not.toContain(
      "config/expose-key-invalid",
    );
    expect(Object.keys(withoutImport.facts.moduleFederation?.exposes ?? {})).toEqual(["./Real"]);
    expect(withoutImport.facts.canonicalConfig?.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/exposes/Widget/dontExpose",
          reason: "extension",
        }),
      ]),
    );
  });

  it("keeps function-valued MF options clone-safe for rule execution", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "fixture",
        manifest: { additionalData: () => ({}) },
      },
      rules: {
        "config/plugin-package-mismatch": "off",
        "doctor/partial-analysis": "off",
      },
    });
    expect(
      result.report.findings.some((item) => item.message.includes("could not be cloned")),
    ).toBe(false);
  });

  it("accepts native Webpack Module Federation when the compiler probe sees the plugin", async () => {
    const facts: ProjectFacts = {
      schemaVersion: 1,
      project: { name: "webpack-native", root: "." },
      bundler: { name: "webpack", mode: "ci", moduleFederationPluginCount: 1 },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: { name: "webpack-native", exposes: {}, remotes: {}, shared: {} },
      dependencies: {
        declared: { webpack: "5.109.2", react: "18.3.1" },
        installed: { webpack: "5.109.2", react: "18.3.1" },
      },
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
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/plugin-package-mismatch")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("accepts Nuxt's official Vite federation adapter", async () => {
    const facts = {
      bundler: { name: "vite", mode: "ci" },
      dependencies: { declared: { "@module-federation/nuxt": "0.1.0" } },
    } as unknown as ProjectFacts;
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/plugin-package-mismatch")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("warns leftover @module-federation/rspack without Enhanced on rspack", async () => {
    const facts = {
      bundler: { name: "rspack", mode: "ci" },
      dependencies: { declared: { "@module-federation/rspack": "0.18.0" } },
    } as unknown as ProjectFacts;
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/plugin-package-mismatch")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([
      expect.objectContaining({
        message:
          'Expected "@module-federation/enhanced" for rspack, not leftover "@module-federation/rspack".',
        evidence: {
          bundler: "rspack",
          expectedPackage: "@module-federation/enhanced",
          declaredPackage: "@module-federation/rspack",
        },
        suggestion:
          "Use `@module-federation/enhanced` (or `@module-federation/enhanced/rspack`) and remove leftover `@module-federation/rspack`.",
      }),
    ]);
  });

  it("warns leftover @module-federation/rspack mixed with Enhanced on rspack", async () => {
    const facts = {
      bundler: { name: "rspack", mode: "ci" },
      dependencies: {
        declared: {
          "@module-federation/enhanced": "0.18.0",
          "@module-federation/rspack": "0.18.0",
        },
      },
    } as unknown as ProjectFacts;
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/plugin-package-mismatch")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([
      expect.objectContaining({
        message:
          'Expected "@module-federation/enhanced" for rspack; leftover "@module-federation/rspack" is the legacy adapter.',
        evidence: {
          bundler: "rspack",
          expectedPackage: "@module-federation/enhanced",
          declaredPackage: "@module-federation/rspack",
        },
      }),
    ]);
  });

  it("accepts Enhanced-only rspack without leftover @module-federation/rspack", async () => {
    const facts = {
      bundler: { name: "rspack", mode: "ci" },
      dependencies: { declared: { "@module-federation/enhanced": "0.18.0" } },
    } as unknown as ProjectFacts;
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/plugin-package-mismatch")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("does not treat leftover @module-federation/rspack as an rsbuild mismatch when the rsbuild plugin is declared", async () => {
    const facts = {
      bundler: { name: "rsbuild", mode: "ci" },
      dependencies: {
        declared: {
          "@module-federation/rsbuild-plugin": "0.18.0",
          "@module-federation/rspack": "0.18.0",
        },
      },
    } as unknown as ProjectFacts;
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/plugin-package-mismatch")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("reads leftover @module-federation/rspack from declared package.json on rspack", async () => {
    const root = await fixture();
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        dependencies: {
          react: "19.1.1",
          "@module-federation/enhanced": "0.18.0",
          "@module-federation/rspack": "0.18.0",
        },
      }),
    );
    const result = await analyze({
      root,
      bundler: "rspack",
      output: { formats: [] },
      moduleFederation: { name: "host" },
      rules: {
        "doctor/partial-analysis": "off",
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/dts-disabled": "off",
        "artifact/manifest-disabled": "off",
        "shared/candidate": "off",
      },
    });
    expect(result.facts.dependencies.declared["@module-federation/rspack"]).toBe("0.18.0");
    expect(result.facts.dependencies.declared["@module-federation/enhanced"]).toBe("0.18.0");
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "config/plugin-package-mismatch",
          evidence: {
            bundler: "rspack",
            expectedPackage: "@module-federation/enhanced",
            declaredPackage: "@module-federation/rspack",
          },
        }),
      ]),
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

  it("classifies authenticated and protocol-relative remotes conservatively", async () => {
    const root = await fixture();
    const analyzeRemote = (entry: string) =>
      analyze({
        root,
        bundler: "vite",
        mode: "development",
        output: { formats: [] },
        extends: ["recommended", "demo"],
        moduleFederation: {
          name: "demo-host",
          shareStrategy: "version-first",
          remotes: { shop: { name: "shop", entry } },
        },
        rules: { "config/plugin-package-mismatch": "off", "doctor/partial-analysis": "off" },
      });

    for (const entry of [
      "//user:pass@localhost:3001/remoteEntry.js",
      "shop@https://user:pass@localhost:3001/remoteEntry.js",
    ]) {
      const result = await analyzeRemote(entry);
      expect(
        result.report.findings.map((finding) => finding.ruleId),
        entry,
      ).not.toContain("config/remote-manifest-recommended");
      expect(
        result.report.findings.map((finding) => finding.ruleId),
        entry,
      ).not.toContain("reliability/version-first-offline-remotes");
    }

    for (const entry of [
      "//user:pass@cdn.example.test/remoteEntry.js",
      "shop@https://user:pass@cdn.example.test/remoteEntry.js",
      "shop@https:remoteEntry.js",
    ]) {
      const result = await analyzeRemote(entry);
      expect(
        result.report.findings.map((finding) => finding.ruleId),
        entry,
      ).toContain("config/remote-manifest-recommended");
      expect(
        result.report.findings.map((finding) => finding.ruleId),
        entry,
      ).toContain("reliability/version-first-offline-remotes");
    }
  });

  it("recommends disabled manifest and DTS only for configured federation surfaces", async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, "src/index.ts"), "export const Widget = {};\n");
    const config = {
      name: "producer",
      manifest: false,
      dts: false,
      exposes: { "./Widget": "./src/index.ts" },
    };
    const quietRules = {
      "config/plugin-package-mismatch": "off" as const,
      "doctor/partial-analysis": "off" as const,
      "config/expose-path-missing": "off" as const,
      "artifact/remote-entry-missing": "off" as const,
      "artifact/types-missing": "off" as const,
      "artifact/types-metadata-missing": "off" as const,
    };

    const production = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      extends: ["recommended", "production"],
      output: { formats: [] },
      moduleFederation: config,
      rules: quietRules,
      failOn: "error",
    });
    expect(
      production.report.findings
        .filter((finding) =>
          ["artifact/manifest-disabled", "artifact/dts-disabled"].includes(finding.ruleId),
        )
        .map((finding) => [finding.ruleId, finding.severity])
        .sort(),
    ).toEqual([
      ["artifact/dts-disabled", "warning"],
      ["artifact/manifest-disabled", "warning"],
    ]);
    expect(production.exitCode).toBe(0);

    const demo = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      extends: ["recommended", "demo"],
      output: { formats: [] },
      moduleFederation: config,
      rules: quietRules,
    });
    expect(
      demo.report.findings.some((finding) => finding.ruleId === "artifact/manifest-disabled"),
    ).toBe(false);
    expect(
      demo.report.findings.find((finding) => finding.ruleId === "artifact/dts-disabled")?.severity,
    ).toBe("info");

    const demoCi = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      extends: ["recommended", "demo"],
      output: { formats: [] },
      moduleFederation: config,
      rules: quietRules,
    });
    expect(
      demoCi.report.findings.find((finding) => finding.ruleId === "artifact/manifest-disabled"),
    ).toMatchObject({ severity: "info" });
    expect(
      demoCi.report.findings.find((finding) => finding.ruleId === "artifact/dts-disabled"),
    ).toMatchObject({ severity: "info" });

    const off = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      extends: ["recommended", "production"],
      output: { formats: [] },
      moduleFederation: config,
      rules: {
        ...quietRules,
        "artifact/manifest-disabled": "off",
        "artifact/dts-disabled": "off",
      },
    });
    expect(off.report.findings.map((finding) => finding.ruleId)).not.toContain(
      "artifact/manifest-disabled",
    );
    expect(off.report.findings.map((finding) => finding.ruleId)).not.toContain(
      "artifact/dts-disabled",
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
      "config/hashed-remote-filename",
      (facts: ProjectFacts) => {
        facts.bundler.name = "webpack";
        facts.moduleFederation!.filename = "remoteEntry.[contenthash].js";
      },
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
      "config/observability-plugin-recommended",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
        facts.dependencies.declared["@module-federation/enhanced"] = "2.8.0";
        facts.dependencies.declared["@module-federation/observability-plugin"] = "2.8.0";
      },
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
      "config/nested-producer-dts-extract",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
        facts.moduleFederation!.remotes = {
          leaf: {
            name: "leaf",
            entry: "https://example.test/leaf/mf-manifest.json",
            shareScope: "default",
          },
        };
        facts.moduleFederation!.dts = { enabled: true, options: {} };
      },
    ],
    [
      "config/js-remote-without-type-urls",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.dts = { enabled: true, options: {} };
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "https://example.test/remoteEntry.js",
            shareScope: "default",
          },
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
      "config/promise-remote-async-boundary",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "https://example.test/mf-manifest.json",
            type: "promise",
            shareScope: "default",
          },
        };
      },
    ],
    [
      "config/copied-webpack-options-on-vite",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.remoteType = "script";
        facts.moduleFederation!.virtualRuntimeEntry = true;
      },
    ],
    [
      "config/copied-vite-options-on-webpack",
      (facts: ProjectFacts) => {
        facts.bundler.name = "webpack";
        facts.moduleFederation!.vite = {
          bundleAllCSS: true,
          ignoreOrigin: false,
          ssrExternals: [],
          virtualModuleDir: "__mf__",
          hostInitInjectLocation: "entry",
          remoteHmr: true,
          varFilename: "remoteEntry.js",
        };
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
      "config/async-boundary-missing",
      (facts: ProjectFacts) => {
        const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "mfdoctor-async-boundary-"));
        fsSync.mkdirSync(path.join(root, "src"));
        fsSync.writeFileSync(
          path.join(root, "src/index.ts"),
          [
            'import React from "react";',
            'import { App } from "./App";',
            "void React;",
            "void App;",
            "",
          ].join("\n"),
        );
        facts.project.root = root;
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        };
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
        };
        facts.imports.sourceFiles = ["src/index.ts"];
        facts.imports.packages = ["react"];
        facts.imports.specifiers = ["react"];
        facts.imports.evidenceSources = ["source"];
      },
    ],
    [
      "config/async-startup-rspack-version",
      (facts: ProjectFacts) => {
        facts.bundler.name = "rspack";
        facts.bundler.version = "1.7.4";
        facts.dependencies.installed["@rspack/core"] = "1.7.4";
        facts.moduleFederation!.experiments = {
          asyncStartup: true,
          externalRuntime: false,
          provideExternalRuntime: false,
        };
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
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared.react!.import = false;
        facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
      },
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
        facts.moduleFederation!.remotes = {
          catalog: {
            name: "catalog",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
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
      "config/split-chunks-mf-runtime",
      (facts: ProjectFacts) => {
        facts.bundler.name = "webpack";
        facts.bundler.splitChunks = {
          chunks: "all",
          cacheGroups: [{ name: "mf-runtime", chunkName: "mf-runtime", test: "mf-" }],
        };
        facts.moduleFederation!.filename = "remoteEntry.js";
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
      "config/alias-share-bypass",
      (facts: ProjectFacts) => {
        facts.bundler.name = "webpack";
        facts.bundler.resolveAliases = { react: "./src/shims/react.ts" };
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
      "vite/virtual-module-dir",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: [],
          virtualModuleDir: "nested/mf",
        };
      },
    ],
    [
      "vite/ignore-origin",
      (facts: ProjectFacts) => {
        facts.bundler.viteConfig = { serverOrigin: null };
        facts.moduleFederation!.vite = {
          bundleAllCSS: false,
          ignoreOrigin: true,
          ssrExternals: [],
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
      "config/shared-externals-conflict",
      (facts: ProjectFacts) => {
        facts.bundler.name = "webpack";
        facts.bundler.externals = ["react"];
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
      "config/rsbuild-mf-api-generation",
      (facts: ProjectFacts) => {
        facts.bundler.name = "rsbuild";
        facts.dependencies.declared["@module-federation/rsbuild-plugin"] = "2.8.2";
        const canonical = readCanonicalModuleFederationConfig({
          name: "fixture",
          options: {
            name: "fixture",
            exposes: { "./Widget": "./src/Widget.ts" },
          },
          exposes: { "./Widget": "./src/Widget.ts" },
        });
        if (canonical) facts.canonicalConfig = canonical;
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
      "shared/prefix-share-recommended",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared = {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
        };
        facts.imports.deepImports = ["react/jsx-runtime"];
        facts.imports.deepImportFiles = { react: ["src/Widget.ts"] };
      },
    ],
    [
      "shared/subpath-version-unresolved",
      (facts: ProjectFacts) => {
        facts.bundler.name = "vite";
        facts.capabilities.installedVersions = true;
        facts.dependencies.installed = {};
        facts.moduleFederation!.shared = {
          "react/": {
            package: "react/",
            singleton: true,
            eager: false,
            shareScope: ["default"],
          },
        };
      },
    ],
    [
      "shared/package-path-missing",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.shared.react!.packagePath =
          "./mfdoctor-missing-shared-package-path";
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
      "artifact/react-dom-server-in-web",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: false,
          target: "web",
        };
        facts.imports.specifiers = ["react-dom/server"];
        facts.imports.deepImports = ["react-dom/server"];
        facts.imports.packages = ["react-dom"];
      },
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
      "ssr/remote-entry-target-mismatch",
      (facts: ProjectFacts) => {
        facts.moduleFederation!.experiments = {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: false,
          target: "web",
        };
        facts.moduleFederation!.remotes = {
          shop: {
            name: "shop",
            entry: "http://localhost:3001/remoteEntry.ssr.js",
            shareScope: "default",
          },
        };
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

  it("still warns version-first-offline-remotes when shareStrategy is omitted", async () => {
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
    expect(findings).not.toHaveLength(0);
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

  async function runSharedUnused(facts: ProjectFacts) {
    const findings: Array<unknown> = [];
    const rule = builtInRules.find((item) => item.meta.id === "shared/unused")!;
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

  it("keeps Vite remotes without manifest on the documented opt-in path", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {
      app1: {
        name: "app1",
        entry: "http://localhost:3001/remoteEntry.js",
        shareScope: "default",
      },
    };
    const findings = await runPartial(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toMatch(/manifest:\s*true/);
    expect(findings[0]?.suggestion).not.toMatch(/emit `mf-stats\.json` by default/);
  });

  it.each(["webpack", "rspack", "rsbuild"] as const)(
    "explains %s remotes with missing stats instead of the Vite opt-in path",
    async (bundler) => {
      const facts = baseFacts();
      facts.bundler.name = bundler;
      facts.capabilities.emittedAssets = true;
      facts.moduleFederation!.remotes = {
        app1: {
          name: "app1",
          entry: "http://localhost:3001/remoteEntry.js",
          shareScope: "default",
        },
      };
      const findings = await runPartial(facts);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.suggestion).toMatch(/mf-stats\.json/);
      expect(findings[0]?.suggestion).toMatch(/manifest !== false/);
      expect(findings[0]?.suggestion).not.toMatch(/unless `manifest: true` is set/);
      expect(findings[0]?.evidence?.missing).toEqual(expect.arrayContaining(["stats"]));
    },
  );

  it("keeps Pass explicit MF options when config capability is missing", async () => {
    const facts = baseFacts();
    facts.capabilities.config = false;
    delete facts.moduleFederation;
    const findings = await runPartial(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.suggestion).toBe("Pass explicit MF options.");
  });

  it("describes unreadable source input without suggesting dynamic-import remediation", async () => {
    const facts = baseFacts();
    facts.imports.sourceReadFailures = ["src/unreadable.ts"];
    const findings = await runPartial(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/unreadable|unknown source input/i);
    expect(findings[0]?.suggestion).toMatch(/unreadable|unknown source input/i);
    expect(findings[0]?.suggestion).not.toMatch(/dynamic import/i);
    expect(findings[0]?.evidence).toMatchObject({ sourceReadFailures: ["src/unreadable.ts"] });
  });

  it("records unobserved Vite/Rsbuild publicPath after adapter emit", async () => {
    const facts = baseFacts();
    facts.capabilities.manifest = true;
    facts.capabilities.stats = true;
    facts.capabilities.emittedAssets = true;
    facts.builds = [
      {
        id: "build-0",
        adapter: "vite",
        bundler: "vite",
        emittedAssets: ["dist/remoteEntry.js"],
        artifacts: [],
        capabilities: {
          outputRoot: { state: "exact", reason: "test" },
          emittedAssets: { state: "exact", reason: "test" },
          artifacts: { state: "unavailable", reason: "test" },
          effectiveMode: { state: "exact", reason: "test" },
          target: { state: "unavailable", reason: "test" },
        },
        sourceHook: "closeBundle",
      },
    ];
    const findings = await runPartial(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence?.missing).toEqual(["outputPublicPath"]);
    expect(findings[0]?.suggestion).toMatch(/publicPath/);
  });

  it("does not treat a recorded publicPath kind as incomplete", async () => {
    const facts = baseFacts();
    facts.capabilities.manifest = true;
    facts.capabilities.stats = true;
    facts.capabilities.emittedAssets = true;
    facts.bundler.outputPublicPathKind = "unknown";
    facts.builds = [
      {
        id: "build-0",
        adapter: "vite",
        bundler: "vite",
        emittedAssets: ["dist/remoteEntry.js"],
        artifacts: [],
        capabilities: {
          outputRoot: { state: "exact", reason: "test" },
          emittedAssets: { state: "exact", reason: "test" },
          artifacts: { state: "unavailable", reason: "test" },
          effectiveMode: { state: "exact", reason: "test" },
          target: { state: "unavailable", reason: "test" },
        },
        sourceHook: "closeBundle",
      },
    ];
    expect(await runPartial(facts)).toHaveLength(0);
  });

  it.each(["unknown", "partial"] as const)(
    "reports %s analysis status even when no budget limit is listed",
    async (status) => {
      const facts = baseFacts();
      facts.analysis = {
        status,
        limits: {
          maxFiles: 10,
          maxSourceBytes: 100,
          maxArtifacts: 10,
          maxEvidenceNodes: 100,
          maxSerializedBytes: 100,
          maxWallTimeMs: 100,
        },
        usage: { files: 1, sourceBytes: 10, artifacts: 0, evidenceNodes: 0, serializedBytes: 0 },
        exceeded: [],
      };
      const findings = await runPartial(facts);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.evidence).toMatchObject({ analysisBudget: { status } });
    },
  );

  it.each(["unknown", "partial"] as const)(
    "does not claim shared packages are unused for %s analysis with no listed budget limit",
    async (status) => {
      const facts = baseFacts();
      facts.moduleFederation!.shared = {
        lodash: { package: "lodash", singleton: false, eager: false, shareScope: "default" },
      };
      facts.analysis = {
        status,
        limits: {
          maxFiles: 10,
          maxSourceBytes: 100,
          maxArtifacts: 10,
          maxEvidenceNodes: 100,
          maxSerializedBytes: 100,
          maxWallTimeMs: 100,
        },
        usage: { files: 1, sourceBytes: 10, artifacts: 0, evidenceNodes: 0, serializedBytes: 0 },
        exceeded: [],
      };

      expect(await runSharedUnused(facts)).toEqual([]);
    },
  );

  it("does not claim a valid late expose is missing after a source-file budget cutoff", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.exposes = { "./Late": "./src/Late.ts" };
    facts.analysis = {
      status: "partial",
      limits: {
        maxFiles: 1,
        maxSourceBytes: 100,
        maxArtifacts: 100,
        maxEvidenceNodes: 100,
        maxSerializedBytes: 100,
        maxWallTimeMs: 100,
      },
      usage: { files: 1, sourceBytes: 10, artifacts: 0, evidenceNodes: 0, serializedBytes: 0 },
      exceeded: [{ kind: "files", limit: 1 }],
    };
    const findings: Array<unknown> = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/expose-path-missing")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("trusts a valid build manifest for an expose omitted from the source import scan", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.exposes = { "./AppIndex": "./src/views/AppIndex" };
    facts.capabilities.manifest = true;
    facts.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      exposes: [{ key: "./AppIndex", assets: ["AppIndex.js"] }],
      shared: [],
    };
    const findings: Array<unknown> = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/expose-path-missing")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("does not trust expose keys from a malformed manifest", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.exposes = { "./Missing": "./src/Missing" };
    facts.capabilities.manifest = true;
    facts.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: false,
      exposes: [{ key: "./Missing", assets: [] }],
      shared: [],
    };
    const findings: Array<unknown> = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/expose-path-missing")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ evidence: { key: "./Missing" } });
  });

  it("does not duplicate a deliberate dts: false finding with types-missing", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.dts = { enabled: false, options: {} };
    facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
    facts.capabilities.manifest = true;
    facts.capabilities.emittedAssets = true;
    facts.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      exposes: [{ key: "./Widget", assets: ["Widget.js"] }],
      shared: [],
    };
    facts.artifacts.emittedAssets = ["dist/mf-manifest.json", "dist/remoteEntry.js"];
    const findings: Array<unknown> = [];
    const rule = builtInRules.find((item) => item.meta.id === "artifact/types-missing")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("uses the manifest remote-entry asset when Vite hashes the default filename", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
    facts.capabilities.manifest = true;
    facts.capabilities.emittedAssets = true;
    facts.artifacts.manifest = {
      path: "dist/mf-manifest.json",
      valid: true,
      remoteEntry: { name: "assets/remoteEntry-AbCd.js", path: "" },
      exposes: [{ key: "./Widget", assets: ["assets/Widget.js"] }],
      shared: [],
    };
    facts.artifacts.emittedAssets = ["dist/mf-manifest.json", "dist/assets/remoteEntry-AbCd.js"];
    const findings: Array<unknown> = [];
    const rule = builtInRules.find((item) => item.meta.id === "artifact/remote-entry-missing")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("does not flag a Vite SSR-suffixed remote entry as a missing client entry", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.exposes = { "./Widget": "src/Widget.ts" };
    facts.capabilities.emittedAssets = true;
    facts.artifacts.emittedAssets = [".svelte-kit/output/server/remoteEntry.ssr.js"];
    facts.builds = [
      {
        targetKind: "node",
      } as NonNullable<ProjectFacts["builds"]>[number],
    ];
    const findings: Array<unknown> = [];
    const rule = builtInRules.find((item) => item.meta.id === "artifact/remote-entry-missing")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });

  it("does not claim a read-failed runtime plugin is missing from source evidence", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.runtimePlugins = ["./src/runtime-plugin.ts"];
    facts.imports.sourceReadFailures = ["src/runtime-plugin.ts"];
    const findings: Array<unknown> = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/runtime-plugin-missing")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
  });
});

describe("config/rsbuild-mf-api-generation", () => {
  async function rsbuildRoot(deps: Record<string, string>) {
    const root = await fixture();
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: deps }),
    );
    await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
    return root;
  }

  it("flags a nested Rsbuild 1.5 options bag on plugin v2", async () => {
    const root = await rsbuildRoot({ "@module-federation/rsbuild-plugin": "2.3.1" });
    const result = await analyze({
      root,
      bundler: "rsbuild",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        options: {
          name: "host",
          exposes: { "./Widget": "./src/Widget.ts" },
        },
        exposes: { "./Widget": "./src/Widget.ts" },
      } as never,
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/manifest-disabled": "off",
      },
    });
    const finding = result.report.findings.find(
      (item) => item.ruleId === "config/rsbuild-mf-api-generation",
    );
    expect(finding).toMatchObject({
      severity: "error",
      evidence: {
        api: "rsbuild-plugin-v2",
        offendingKeys: ["options"],
      },
    });
  });

  it("flags MF 2.0 generation options on Rsbuild moduleFederation.options (1.5)", async () => {
    const root = await rsbuildRoot({ "@rsbuild/core": "1.5.0" });
    const result = await analyze({
      root,
      bundler: "rsbuild",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        exposes: { "./Widget": "./src/Widget.ts" },
        dts: true,
        manifest: true,
        getPublicPath: "function(){return '/';}",
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
      },
    });
    const finding = result.report.findings.find(
      (item) => item.ruleId === "config/rsbuild-mf-api-generation",
    );
    expect(finding?.evidence.offendingKeys).toEqual(
      expect.arrayContaining(["dts", "getPublicPath", "manifest"]),
    );
    expect(finding?.evidence.api).toBe("rsbuild-moduleFederation-options-1.5");
  });

  it("stays quiet on a valid rsbuild-plugin v2 config", async () => {
    const root = await rsbuildRoot({ "@module-federation/rsbuild-plugin": "2.3.1" });
    const result = await analyze({
      root,
      bundler: "rsbuild",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        exposes: { "./Widget": "./src/Widget.ts" },
        dts: true,
        manifest: true,
        remotes: {
          shop: "shop@https://example.test/mf-manifest.json",
        },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
      },
    });
    expect(result.report.findings.map((item) => item.ruleId)).not.toContain(
      "config/rsbuild-mf-api-generation",
    );
  });

  it("ignores non-rsbuild bundlers", async () => {
    const root = await rsbuildRoot({ "@module-federation/vite": "2.8.0" });
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        options: { name: "host" },
        exposes: { "./Widget": "./src/Widget.ts" },
      } as never,
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
      },
    });
    expect(result.report.findings.map((item) => item.ruleId)).not.toContain(
      "config/rsbuild-mf-api-generation",
    );
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

  it("skips MFDoctor [external]/ path rewrites", async () => {
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

describe("config/async-boundary-missing", () => {
  const caseRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      caseRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  async function hostRoot(entrySource: string, extraFiles: Record<string, string> = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-async-boundary-case-"));
    caseRoots.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src/index.ts"), entrySource);
    for (const [file, source] of Object.entries(extraFiles)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), source);
    }
    return root;
  }

  function factsFor(root: string, overrides: Partial<ProjectFacts> = {}): ProjectFacts {
    return {
      schemaVersion: 1,
      project: { name: "host", root },
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
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        },
        shared: {
          react: { package: "react", singleton: true, eager: false, shareScope: "default" },
        },
        experiments: {
          asyncStartup: false,
          externalRuntime: false,
          provideExternalRuntime: false,
        },
      },
      dependencies: { declared: { react: "^19" }, installed: { react: "19.1.1" } },
      imports: {
        sourceFiles: ["src/index.ts"],
        specifiers: ["react"],
        packages: ["react"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
      ...overrides,
    };
  }

  async function run(facts: ProjectFacts) {
    const findings: Array<{ message: string; evidence?: Record<string, unknown> }> = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/async-boundary-missing")!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("flags a host sync entry that imports non-eager shared packages", async () => {
    const root = await hostRoot('import React from "react";\nvoid React;\n');
    const findings = await run(factsFor(root));
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("RUNTIME-005"),
        evidence: expect.objectContaining({
          errorCode: "RUNTIME-005",
          entry: "src/index.ts",
          packages: ["react"],
        }),
      }),
    ]);
  });

  it("does not fire when the entry only dynamically imports bootstrap", async () => {
    const root = await hostRoot('import("./bootstrap");\n', {
      "src/bootstrap.ts": 'import React from "react";\nvoid React;\n',
    });
    const findings = await run({
      ...factsFor(root),
      imports: {
        sourceFiles: ["src/index.ts", "src/bootstrap.ts"],
        specifiers: ["react"],
        packages: ["react"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
    });
    expect(findings).toEqual([]);
  });

  it("does not fire when experiments.asyncStartup is enabled", async () => {
    const root = await hostRoot('import React from "react";\nvoid React;\n');
    const facts = factsFor(root);
    facts.moduleFederation!.experiments = {
      asyncStartup: true,
      externalRuntime: false,
      provideExternalRuntime: false,
    };
    expect(await run(facts)).toEqual([]);
  });

  it("does not fire for non-host projects without remotes", async () => {
    const root = await hostRoot('import React from "react";\nvoid React;\n');
    const facts = factsFor(root);
    facts.moduleFederation!.remotes = {};
    expect(await run(facts)).toEqual([]);
  });

  it("does not treat PascalCase App.tsx as a bundler entry", async () => {
    const root = await hostRoot('import React from "react";\nvoid React;\n');
    await fs.writeFile(path.join(root, "src/App.tsx"), 'import React from "react";\nvoid React;\n');
    await fs.rm(path.join(root, "src/index.ts"));
    const findings = await run({
      ...factsFor(root),
      imports: {
        sourceFiles: ["src/App.tsx"],
        specifiers: ["react"],
        packages: ["react"],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
    });
    expect(findings).toEqual([]);
  });

  it("does not fire when shared packages are eager", async () => {
    const root = await hostRoot('import React from "react";\nvoid React;\n');
    const facts = factsFor(root);
    facts.moduleFederation!.shared.react!.eager = true;
    expect(await run(facts)).toEqual([]);
  });
});

describe("Vite/Nuxt artifact false positives", () => {
  async function runRule(id: string, facts: ProjectFacts, options: Record<string, unknown> = {}) {
    const findings: Array<{ message: string; evidence?: Record<string, unknown> }> = [];
    const rule = builtInRules.find((item) => item.meta.id === id)!;
    await rule.check({ facts, options, report: (finding) => findings.push(finding) });
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

  it("accepts an output-directory-prefixed remote entry beside its manifest", async () => {
    const facts = viteBase();
    facts.artifacts.manifest = {
      ...facts.artifacts.manifest!,
      path: "dist/first/mf-manifest.json",
      remoteEntry: { name: "first/firstRemoteEntry.js", path: "" },
    };
    facts.artifacts.emittedAssets = ["dist/first/firstRemoteEntry.js"];
    expect(await runRule("artifact/manifest-remote-entry-missing", facts)).toHaveLength(0);
  });

  it("matches output-directory-prefixed entries against the active build only", async () => {
    const facts = viteBase();
    facts.artifacts.manifest = {
      ...facts.artifacts.manifest!,
      path: "dist/first/mf-manifest.json",
      remoteEntry: { name: "first/firstRemoteEntry.js", path: "" },
    };
    facts.artifacts.emittedAssets = ["dist/first/firstRemoteEntry.js"];
    facts.builds = [
      {
        id: "vite-build-1",
        adapter: "vite",
        bundler: "vite",
        emittedAssets: ["dist/first/firstRemoteEntry.js"],
        artifacts: [],
        capabilities: {
          outputRoot: { state: "exact", reason: "test" },
          emittedAssets: { state: "exact", reason: "test" },
          artifacts: { state: "exact", reason: "test" },
          effectiveMode: { state: "exact", reason: "test" },
          target: { state: "exact", reason: "test" },
        },
        sourceHook: "closeBundle",
      },
    ];
    expect(await runRule("artifact/manifest-remote-entry-missing", facts)).toHaveLength(0);

    facts.artifacts.emittedAssets = ["dist/second/firstRemoteEntry.js"];
    expect(await runRule("artifact/manifest-remote-entry-missing", facts)).not.toHaveLength(0);
  });

  it("applies the remote-entry budget to an output-directory-prefixed entry", async () => {
    const facts = viteBase();
    facts.artifacts.manifest = {
      ...facts.artifacts.manifest!,
      path: "dist/first/mf-manifest.json",
      remoteEntry: { name: "first/firstRemoteEntry.js", path: "" },
    };
    facts.artifacts.assetSizes = { "dist/first/firstRemoteEntry.js": 1200 };
    facts.builds = [
      {
        id: "vite-build-1",
        adapter: "vite",
        bundler: "vite",
        emittedAssets: ["dist/first/firstRemoteEntry.js"],
        artifacts: [],
        capabilities: {
          outputRoot: { state: "exact", reason: "test" },
          emittedAssets: { state: "exact", reason: "test" },
          artifacts: { state: "exact", reason: "test" },
          effectiveMode: { state: "exact", reason: "test" },
          target: { state: "exact", reason: "test" },
        },
        sourceHook: "closeBundle",
      },
    ];

    const findings = await runRule("performance/asset-budget", facts, {
      remoteEntryMaxBytes: 5,
    });
    expect(findings.some((finding) => finding.message.includes("Remote entry exceeds"))).toBe(true);
  });

  it("applies expose and shared budgets relative to the build output root", async () => {
    const facts = viteBase();
    facts.artifacts.manifest = {
      ...facts.artifacts.manifest!,
      path: "dist/first/mf-manifest.json",
      exposes: [{ key: "./Widget", assets: ["assets/expose.js"] }],
      shared: [{ name: "react", assets: ["assets/shared.js"] }],
    };
    facts.artifacts.assetSizes = {
      "dist/assets/expose.js": 1200,
      "dist/assets/shared.js": 1200,
    };
    facts.builds = [
      {
        id: "vite-build-1",
        adapter: "vite",
        bundler: "vite",
        outputRoot: "dist",
        emittedAssets: ["dist/assets/expose.js", "dist/assets/shared.js"],
        artifacts: [],
        capabilities: {
          outputRoot: { state: "exact", reason: "test" },
          emittedAssets: { state: "exact", reason: "test" },
          artifacts: { state: "exact", reason: "test" },
          effectiveMode: { state: "exact", reason: "test" },
          target: { state: "exact", reason: "test" },
        },
        sourceHook: "closeBundle",
      },
    ];

    const findings = await runRule("performance/asset-budget", facts, {
      exposeMaxBytes: 5,
      sharedMaxBytes: 5,
    });
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('Expose "./Widget" exceeds') }),
        expect.objectContaining({
          message: expect.stringContaining('Shared package "react" exceeds'),
        }),
      ]),
    );
  });

  it("accepts a host manifest with no own remote entry", async () => {
    const facts = viteBase();
    facts.moduleFederation!.exposes = {};
    facts.artifacts.manifest!.remoteEntry = { name: "", path: "" };
    expect(await runRule("artifact/manifest-remote-entry-missing", facts)).toHaveLength(0);
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

  it("deduplicates shared manifest records that point at one emitted chunk", async () => {
    const facts = viteBase();
    facts.artifacts.manifest!.shared = [
      { name: "react", assets: ["assets/shared.js"] },
      { name: "react-dom", assets: ["assets/shared.js"] },
      { name: "react-dom/client", assets: ["assets/shared.js"] },
    ];
    facts.artifacts.assetSizes = { "assets/shared.js": 600_000 };
    const findings = await runRule("performance/asset-budget", facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toMatchObject({
      target: "shared federation assets",
      packages: ["react", "react-dom", "react-dom/client"],
      bytes: 600_000,
    });
  });

  it("does not call an explicit manifest opt-out partial analysis", async () => {
    const facts = viteBase();
    facts.bundler.name = "rspack";
    facts.capabilities.manifest = false;
    facts.capabilities.stats = false;
    facts.moduleFederation!.manifest = { enabled: false, options: {} };
    expect(await runRule("doctor/partial-analysis", facts)).toHaveLength(0);
  });

  it("does not duplicate Vite's disabled default manifest as partial analysis", async () => {
    const facts = viteBase();
    facts.capabilities.manifest = false;
    facts.capabilities.stats = false;
    facts.moduleFederation!.manifest = { enabled: false, options: {} };
    delete facts.artifacts.manifest;
    expect(await runRule("doctor/partial-analysis", facts)).toHaveLength(0);
    expect(await runRule("artifact/manifest-disabled", facts)).toHaveLength(1);
  });

  it("accepts a root runtime plugin that is outside the source scanner", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-runtime-plugin-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "runtimePlugin.ts"), "export default {};");
    const facts = viteBase();
    facts.moduleFederation!.runtimePlugins = ["./runtimePlugin.ts"];
    facts.imports.sourceFiles = [];
    const findings: unknown[] = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/runtime-plugin-missing")!;
    await rule.check({ facts, root, options: {}, report: (finding) => findings.push(finding) });
    expect(findings).toEqual([]);
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

describe("promise and script remote types", () => {
  function baseFacts(bundler: ProjectFacts["bundler"]["name"] = "webpack"): ProjectFacts {
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
      },
      dependencies: { declared: { "@module-federation/enhanced": "0.21.0" }, installed: {} },
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

  async function run(id: string, facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find((item) => item.meta.id === id)!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  function promiseRemote(
    type: string | undefined = "promise",
  ): NonNullable<ProjectFacts["moduleFederation"]>["remotes"] {
    return {
      shop: {
        name: "shop",
        entry:
          type === undefined
            ? "promise new Promise((resolve) => { resolve({}); })"
            : "https://example.test/mf-manifest.json",
        ...(type ? { type } : {}),
        shareScope: "default",
      },
    };
  }

  it("warns when a promise remote has no asyncStartup or bootstrap", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = promiseRemote();
    const findings = await run("config/promise-remote-async-boundary", facts);
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("Promise remote"),
        evidence: expect.objectContaining({
          asyncStartup: false,
          bootstrap: false,
          remotes: [expect.objectContaining({ name: "shop", type: "promise" })],
        }),
      }),
    ]);
  });

  it("stays quiet when experiments.asyncStartup is enabled", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = promiseRemote();
    facts.moduleFederation!.experiments = {
      asyncStartup: true,
      externalRuntime: false,
      provideExternalRuntime: false,
    };
    expect(await run("config/promise-remote-async-boundary", facts)).toHaveLength(0);
  });

  it("stays quiet when a bootstrap file is present", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = promiseRemote();
    facts.imports.sourceFiles = ["src/index.ts", "src/bootstrap.ts"];
    expect(await run("config/promise-remote-async-boundary", facts)).toHaveLength(0);
  });

  it("warns on webpack string promise remotes", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = promiseRemote(undefined);
    const findings = await run("config/promise-remote-async-boundary", facts);
    expect(findings).not.toHaveLength(0);
    expect(findings[0]?.evidence).toMatchObject({
      remotes: [expect.objectContaining({ name: "shop", type: "promise" })],
    });
  });

  it("extends library-remote-type-mismatch for script remotes on an ESM library", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.library = { type: "module" };
    facts.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "https://example.test/remoteEntry.js",
        type: "script",
        shareScope: "default",
      },
    };
    const findings = await run("config/library-remote-type-mismatch", facts);
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('"shop"'),
        evidence: expect.objectContaining({
          libraryType: "module",
          remotes: [expect.objectContaining({ name: "shop", type: "script" })],
        }),
      }),
    ]);
  });

  it("still flags top-level remoteType script against an ESM library", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.library = { type: "module" };
    facts.moduleFederation!.remoteType = "script";
    const findings = await run("config/library-remote-type-mismatch", facts);
    expect(findings).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({ libraryType: "module", remoteType: "script" }),
      }),
    ]);
  });

  it("does not crash or warn on unknown remote types", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.library = { type: "module" };
    facts.moduleFederation!.remotes = {
      shop: {
        name: "shop",
        entry: "https://example.test/remoteEntry.js",
        type: "not-a-real-type",
        shareScope: "default",
      },
      other: {
        name: "other",
        entry: "https://example.test/other.js",
        type: "",
        shareScope: "default",
      },
    };
    expect(await run("config/library-remote-type-mismatch", facts)).toHaveLength(0);
    expect(await run("config/promise-remote-async-boundary", facts)).toHaveLength(0);
    expect(await run("vite/remotes-prefer-module", facts)).toHaveLength(0);
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
    facts.moduleFederation!.remotes = {
      catalog: {
        name: "catalog",
        entry: "https://example.test/mf-manifest.json",
        shareScope: "default",
      },
    };
    facts.moduleFederation!.vite!.target = "node";
    facts.moduleFederation!.vite!.hostInitInjectLocation = "html";
    expect(await run("vite/host-init-inject-ssr", facts)).not.toHaveLength(0);

    delete facts.moduleFederation!.vite!.hostInitInjectLocation;
    expect(await run("vite/host-init-inject-ssr", facts)).not.toHaveLength(0);
  });

  it("stays quiet for an SSR producer without configured remotes", async () => {
    const producer = baseFacts();
    producer.moduleFederation!.vite!.target = "node";
    expect(await run("vite/host-init-inject-ssr", producer)).toHaveLength(0);
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

  it.each(["rsbuild", "modern", "webpack", "rspack"] as const)(
    "skips host-init inject on %s even when SSR signals exist",
    async (bundler) => {
      const facts = baseFacts();
      facts.bundler.name = bundler;
      facts.moduleFederation!.remotes = {
        catalog: {
          name: "catalog",
          entry: "https://example.test/mf-manifest.json",
          shareScope: "default",
        },
      };
      facts.moduleFederation!.vite!.target = "node";
      delete facts.moduleFederation!.vite!.hostInitInjectLocation;
      expect(await run("vite/host-init-inject-ssr", facts)).toHaveLength(0);
    },
  );

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

  it("uses an explicit recommendation for the Vite server-origin signal", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      viteConfigFacts: { serverOrigin: null, serverPort: 4173 },
      moduleFederation: {
        name: "host",
        remotes: { shop: { name: "shop", entry: "http://localhost:4174/remoteEntry.js" } },
      },
      output: { formats: [] },
      rules: {
        "vite/server-origin": ["info", { recommendedOrigin: "http://localhost:9999" }],
      },
    });
    expect(
      result.report.findings.find((item) => item.ruleId === "vite/server-origin"),
    ).toMatchObject({
      severity: "info",
      evidence: { recommendedOrigin: "http://localhost:9999" },
    });
  });

  it("uses the Vite default when the dev server requests an automatic port", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "development",
      viteConfigFacts: { serverOrigin: null, serverPort: 0 },
      moduleFederation: {
        name: "host",
        remotes: { shop: { name: "shop", entry: "http://localhost:4174/remoteEntry.js" } },
      },
      output: { formats: [] },
    });
    expect(
      result.report.findings.find((item) => item.ruleId === "vite/server-origin"),
    ).toMatchObject({ evidence: { recommendedOrigin: "http://localhost:5173" } });
  });
});

describe("vite/virtual-module-dir and vite/ignore-origin", () => {
  async function run(id: string, facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find((item) => item.meta.id === id)!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  function viteFacts(overrides: Partial<ProjectFacts> = {}): ProjectFacts {
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
        exposes: { "./Widget": "src/Widget.ts" },
        remotes: {},
        shared: {},
        vite: { bundleAllCSS: false, ignoreOrigin: false, ssrExternals: [] },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: ["src/Widget.ts"],
        specifiers: [],
        packages: [],
        dynamicPackages: [],
        remotes: [],
        unresolvedDynamic: [],
        evidenceSources: ["source"],
      },
      artifacts: { emittedAssets: [] },
      ...overrides,
    };
  }

  it("warns when virtualModuleDir contains a slash", async () => {
    const facts = viteFacts();
    facts.moduleFederation!.vite!.virtualModuleDir = "nested/mf";
    expect(await run("vite/virtual-module-dir", facts)).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("virtualModuleDir"),
        evidence: { virtualModuleDir: "nested/mf" },
      }),
    ]);
  });

  it("warns when virtualModuleDir contains a backslash", async () => {
    const facts = viteFacts();
    facts.moduleFederation!.vite!.virtualModuleDir = "nested\\mf";
    expect(await run("vite/virtual-module-dir", facts)).not.toHaveLength(0);
  });

  it("stays quiet for a simple virtualModuleDir name", async () => {
    const facts = viteFacts();
    facts.moduleFederation!.vite!.virtualModuleDir = "__mf__";
    expect(await run("vite/virtual-module-dir", facts)).toHaveLength(0);
  });

  it("stays quiet on webpack even when virtualModuleDir has slashes", async () => {
    const facts = viteFacts();
    facts.bundler.name = "webpack";
    facts.moduleFederation!.vite!.virtualModuleDir = "nested/mf";
    expect(await run("vite/virtual-module-dir", facts)).toHaveLength(0);
  });

  it("reports info when ignoreOrigin is true without a server.origin fact", async () => {
    const facts = viteFacts();
    facts.bundler.viteConfig = { serverOrigin: null };
    facts.moduleFederation!.vite!.ignoreOrigin = true;
    expect(await run("vite/ignore-origin", facts)).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("ignoreOrigin"),
        evidence: { ignoreOrigin: true, serverOrigin: null },
      }),
    ]);
  });

  it("stays quiet when ignoreOrigin is true with a tested server.origin", async () => {
    const facts = viteFacts();
    facts.bundler.viteConfig = { serverOrigin: "http://localhost:5173" };
    facts.moduleFederation!.vite!.ignoreOrigin = true;
    expect(await run("vite/ignore-origin", facts)).toHaveLength(0);
  });

  it("skips ignoreOrigin when the plugin origin fact is unobserved", async () => {
    const facts = viteFacts();
    facts.moduleFederation!.vite!.ignoreOrigin = true;
    expect(await run("vite/ignore-origin", facts)).toHaveLength(0);
  });

  it("stays quiet when ignoreOrigin is false", async () => {
    const facts = viteFacts();
    facts.bundler.viteConfig = { serverOrigin: null };
    expect(await run("vite/ignore-origin", facts)).toHaveLength(0);
  });

  it("surfaces both findings through analyze", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      viteConfigFacts: { serverOrigin: null },
      moduleFederation: {
        name: "host",
        ignoreOrigin: true,
        virtualModuleDir: "nested/mf",
        exposes: { "./Widget": "./src/index.ts" },
      },
      output: { formats: [] },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/manifest-disabled": "off",
        "artifact/dts-disabled": "off",
      },
    });
    const ids = result.report.findings.map((item) => item.ruleId);
    expect(ids).toContain("vite/virtual-module-dir");
    expect(ids).toContain("vite/ignore-origin");
    expect(
      result.report.findings.find((item) => item.ruleId === "vite/virtual-module-dir"),
    ).toMatchObject({
      severity: "warning",
    });
    expect(
      result.report.findings.find((item) => item.ruleId === "vite/ignore-origin"),
    ).toMatchObject({
      severity: "info",
    });
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

describe("config/js-remote-without-type-urls", () => {
  async function run(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find(
      (item) => item.meta.id === "config/js-remote-without-type-urls",
    )!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  function host(remotes: NonNullable<ProjectFacts["moduleFederation"]>["remotes"]): ProjectFacts {
    return {
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
        name: "host",
        exposes: {},
        remotes,
        shared: {},
        dts: { enabled: true, options: {} },
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

  const jsRemote = {
    shop: {
      name: "shop",
      entry: "https://cdn.example.test/remoteEntry.js",
      shareScope: "default" as const,
    },
  };
  const manifestRemote = {
    shop: {
      name: "shop",
      entry: "https://cdn.example.test/mf-manifest.json",
      shareScope: "default" as const,
    },
  };

  it("warns when a host consumes types from a .js remote without remoteTypeUrls", async () => {
    expect(await run(host(jsRemote))).toMatchObject([
      {
        message:
          'Remote "shop" points at a .js entry while dts consumeTypes is on and remoteTypeUrls does not cover it.',
        evidence: {
          alias: "shop",
          remote: "shop",
          entry: "https://cdn.example.test/remoteEntry.js",
        },
      },
    ]);
  });

  it("skips manifest remotes, disabled consumeTypes, and covered .js remotes", async () => {
    expect(await run(host(manifestRemote))).toHaveLength(0);

    const consumeOff = host(jsRemote);
    consumeOff.moduleFederation!.dts = { enabled: true, options: { consumeTypes: false } };
    expect(await run(consumeOff)).toHaveLength(0);

    const dtsOff = host(jsRemote);
    dtsOff.moduleFederation!.dts = { enabled: false, options: {} };
    expect(await run(dtsOff)).toHaveLength(0);

    const covered = host(jsRemote);
    covered.moduleFederation!.dts = {
      enabled: true,
      options: {
        consumeTypes: {
          remoteTypeUrls: {
            shop: {
              alias: "shop",
              api: "https://cdn.example.test/@mf-types.d.ts",
              zip: "https://cdn.example.test/@mf-types.zip",
            },
          },
        },
      },
    };
    expect(await run(covered)).toHaveLength(0);

    const functionUrls = host(jsRemote);
    functionUrls.moduleFederation!.dts = {
      enabled: true,
      options: { consumeTypes: { remoteTypeUrls: true } },
    };
    expect(await run(functionUrls)).toHaveLength(0);
  });

  it("flags only uncovered .js remotes in a mixed host", async () => {
    const mixed = host({
      shop: {
        name: "shop",
        entry: "https://cdn.example.test/remoteEntry.js",
        shareScope: "default",
      },
      catalog: {
        name: "catalog",
        entry: "https://cdn.example.test/mf-manifest.json",
        shareScope: "default",
      },
      cart: {
        name: "cart_app",
        entry: "https://cdn.example.test/cart/remoteEntry.mjs",
        shareScope: "default",
      },
    });
    mixed.moduleFederation!.dts = {
      enabled: true,
      options: {
        consumeTypes: {
          remoteTypeUrls: {
            cart_app: { alias: "cart", zip: "https://cdn.example.test/cart/@mf-types.zip" },
          },
        },
      },
    };
    expect(await run(mixed)).toMatchObject([
      { evidence: { alias: "shop", entry: "https://cdn.example.test/remoteEntry.js" } },
    ]);
  });

  it("reports through analyze and stays quiet for a manifest host", async () => {
    const quiet = {
      "doctor/partial-analysis": "off" as const,
      "config/plugin-package-mismatch": "off" as const,
      "artifact/remote-entry-missing": "off" as const,
      "config/remote-manifest-recommended": "off" as const,
      "reliability/version-first-offline-remotes": "off" as const,
      "vite/remotes-prefer-module": "off" as const,
    };
    const root = await fixture();
    const failing = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        remotes: { shop: "https://cdn.example.test/remoteEntry.js" },
      },
      rules: quiet,
    });
    expect(
      failing.report.findings.find((item) => item.ruleId === "config/js-remote-without-type-urls"),
    ).toMatchObject({
      severity: "warning",
      evidence: { alias: "shop", entry: "https://cdn.example.test/remoteEntry.js" },
    });

    const passing = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        remotes: { shop: "https://cdn.example.test/mf-manifest.json" },
      },
      rules: quiet,
    });
    expect(
      passing.report.findings.some((item) => item.ruleId === "config/js-remote-without-type-urls"),
    ).toBe(false);
  });
});

describe("config/shared-externals-conflict", () => {
  async function run(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find(
      (item) => item.meta.id === "config/shared-externals-conflict",
    )!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  function base(): ProjectFacts {
    return {
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
        name: "host",
        exposes: {},
        remotes: {},
        shared: {
          react: { package: "react", singleton: true, eager: false, shareScope: ["default"] },
        },
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

  it("warns when a shared package is also listed in public externals", async () => {
    const overlap = base();
    overlap.bundler.externals = ["react", "lodash"];
    expect(await run(overlap)).toMatchObject([
      {
        message: "Shared packages are also listed in bundler externals.",
        evidence: { overlaps: ["react"] },
      },
    ]);
  });

  it("stays silent without overlap, when unobserved, and for function-only externals", async () => {
    const noOverlap = base();
    noOverlap.bundler.externals = ["lodash"];
    expect(await run(noOverlap)).toHaveLength(0);

    const observedEmpty = base();
    observedEmpty.bundler.externals = [];
    expect(await run(observedEmpty)).toHaveLength(0);

    const missing = base();
    expect(await run(missing)).toHaveLength(0);
  });

  it("matches prefix shares and honors allowPackages", async () => {
    const prefix = base();
    prefix.moduleFederation!.shared = {
      "react/": { package: "react", singleton: true, eager: false, shareScope: ["default"] },
    };
    prefix.bundler.externals = ["react/jsx-runtime"];
    expect(await run(prefix)).not.toHaveLength(0);

    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find(
      (item) => item.meta.id === "config/shared-externals-conflict",
    )!;
    const allow = base();
    allow.bundler.externals = ["react"];
    await selected.check({
      facts: allow,
      options: { allowPackages: ["react"] },
      report: (finding) => findings.push(finding),
    });
    expect(findings).toHaveLength(0);
  });

  it("collects DoctorOptions.externals and reports through analyze", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      output: { formats: [] },
      externals: { react: "React" },
      moduleFederation: {
        name: "host",
        shared: { react: { singleton: true } },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "shared/singleton-risk": "off",
        "shared/candidate": "off",
        "shared/unused": "off",
        "artifact/remote-entry-missing": "off",
      },
    });
    expect(result.facts.bundler.externals).toEqual(["react"]);
    expect(
      result.report.findings.find((item) => item.ruleId === "config/shared-externals-conflict"),
    ).toMatchObject({
      evidence: { overlaps: ["react"] },
    });
  });
});

describe("config/alias-share-bypass", () => {
  async function run(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const selected = builtInRules.find((item) => item.meta.id === "config/alias-share-bypass")!;
    await selected.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  function base(bundler: ProjectFacts["bundler"]["name"]): ProjectFacts {
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
        shared: {
          react: { package: "react", singleton: true, eager: false, shareScope: ["default"] },
        },
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

  it.each(["webpack", "rspack", "rsbuild"] as const)(
    "warns when %s resolve.alias overlaps shared",
    async (bundler) => {
      const facts = base(bundler);
      facts.bundler.resolveAliases = { react: "./src/shims/react.ts" };
      expect(await run(facts)).not.toHaveLength(0);
    },
  );

  it("leaves the Vite sibling unchanged and stays quiet on Vite", async () => {
    const webpack = base("webpack");
    webpack.bundler.viteConfig = { resolveAliases: { react: "./src/shims/react.ts" } };
    expect(await run(webpack)).toHaveLength(0);

    const vite = base("vite");
    vite.bundler.resolveAliases = { react: "./src/shims/react.ts" };
    expect(await run(vite)).toHaveLength(0);
  });

  it("stays silent without overlap, without facts, and for function aliases", async () => {
    const noOverlap = base("webpack");
    noOverlap.bundler.resolveAliases = { lodash: "./src/shims/lodash.ts" };
    expect(await run(noOverlap)).toHaveLength(0);

    const missing = base("rspack");
    expect(await run(missing)).toHaveLength(0);

    const fn = base("rsbuild");
    fn.bundler.resolveAliasFunction = true;
    expect(await run(fn)).toHaveLength(0);
  });

  it.each(["webpack", "rspack", "rsbuild"] as const)(
    "flags CLI resolveAliases on %s via analyze()",
    async (bundler) => {
      const root = await fixture();
      const result = await analyze({
        root,
        bundler,
        mode: "ci",
        resolveAliases: { react: "./src/shims/react.ts" },
        moduleFederation: {
          name: "host",
          filename: "remoteEntry.js",
          shared: { react: { singleton: true } },
        },
        output: { formats: [] },
        rules: {
          "doctor/partial-analysis": "off",
          "config/plugin-package-mismatch": "off",
          "artifact/remote-entry-missing": "off",
          "artifact/types-missing": "off",
          "artifact/types-metadata-missing": "off",
          "artifact/manifest-disabled": "off",
        },
      });
      expect(result.report.findings.map((item) => item.ruleId)).toContain(
        "config/alias-share-bypass",
      );
    },
  );

  it("does not flag Vite through CLI resolveAliases (vite/alias-share-bypass stays on viteConfig)", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      resolveAliases: { react: "./src/shims/react.ts" },
      moduleFederation: {
        name: "host",
        filename: "remoteEntry.js",
        shared: { react: { singleton: true } },
      },
      output: { formats: [] },
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/manifest-disabled": "off",
        "vite/alias-share-bypass": "warning",
      },
    });
    const ids = result.report.findings.map((item) => item.ruleId);
    expect(ids).not.toContain("config/alias-share-bypass");
    expect(ids).not.toContain("vite/alias-share-bypass");
  });
});

describe("config/split-chunks-mf-runtime", () => {
  const rule = builtInRules.find((item) => item.meta.id === "config/split-chunks-mf-runtime")!;

  function webpackFacts(splitChunks?: ProjectFacts["bundler"]["splitChunks"]): ProjectFacts {
    return {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: { name: "webpack", mode: "ci", ...(splitChunks ? { splitChunks } : {}) },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
      moduleFederation: {
        name: "shop",
        filename: "remoteEntry.js",
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

  async function run(
    facts: ProjectFacts,
    options: Record<string, unknown> = {},
  ): Promise<
    Array<Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">>
  > {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    await rule.check({ facts, options, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("skips when optimization is unobserved", async () => {
    expect(await run(webpackFacts())).toHaveLength(0);
  });

  it("does not nag on chunks: all without MF cacheGroups", async () => {
    expect(
      await run(
        webpackFacts({
          chunks: "all",
          cacheGroups: [{ name: "defaultVendors", test: String.raw`[\\/]node_modules[\\/]` }],
        }),
      ),
    ).toHaveLength(0);
  });

  it("warns when a cacheGroup is named for the MF runtime", async () => {
    const findings = await run(
      webpackFacts({
        chunks: "all",
        cacheGroups: [{ name: "mf-runtime", chunkName: "mf-runtime" }],
      }),
    );
    expect(findings).toMatchObject([
      {
        message: "splitChunks cacheGroups target Module Federation runtime chunks.",
        evidence: { chunks: "all", cacheGroups: ["mf-runtime"], chunkNames: ["mf-runtime"] },
      },
    ]);
  });

  it("warns when a cacheGroup test matches remoteEntry", async () => {
    const findings = await run(
      webpackFacts({
        cacheGroups: [{ name: "container", test: "remoteEntry" }],
      }),
    );
    expect(findings[0]?.evidence).toMatchObject({ cacheGroups: ["container"] });
  });

  it("warns when a cacheGroup matches the observed remoteEntry filename", async () => {
    const facts = webpackFacts({
      cacheGroups: [{ name: "container", chunkName: "shopContainer" }],
    });
    facts.moduleFederation!.filename = "shopContainer.js";
    expect(await run(facts)).not.toHaveLength(0);
  });

  it("honors allowSplitChunks", async () => {
    expect(
      await run(webpackFacts({ cacheGroups: [{ name: "mf-runtime" }] }), {
        allowSplitChunks: true,
      }),
    ).toHaveLength(0);
  });

  it("skips Vite projects", async () => {
    const facts = webpackFacts({ cacheGroups: [{ name: "mf-runtime" }] });
    facts.bundler.name = "vite";
    expect(await run(facts)).toHaveLength(0);
  });

  it("analyzes through the CLI option snapshot for webpack, rspack, and rsbuild", async () => {
    const root = await fixture();
    for (const bundler of ["webpack", "rspack", "rsbuild"] as const) {
      const result = await analyze({
        root,
        bundler,
        mode: "ci",
        output: { formats: [] },
        splitChunksFacts: {
          cacheGroups: [{ name: "remoteEntry", chunkName: "remoteEntry" }],
        },
        moduleFederation: {
          name: "shop",
          filename: "remoteEntry.js",
          exposes: { "./Widget": "./src/index.ts" },
        },
        rules: {
          "artifact/remote-entry-missing": "off",
          "artifact/types-missing": "off",
          "artifact/expose-missing": "off",
          "config/plugin-package-mismatch": "off",
          "doctor/partial-analysis": "off",
        },
      });
      expect(
        result.report.findings.some(
          (finding) => finding.ruleId === "config/split-chunks-mf-runtime",
        ),
        bundler,
      ).toBe(true);
    }
  });
});

describe("Group 6 evidence bridge", () => {
  async function runMigrated(
    facts: ProjectFacts,
    settings: Readonly<Record<string, import("../../src/types.js").RuleSetting>> = {},
    selectedBuild?: import("../../src/types.js").BuildRecord,
  ) {
    const { runMigratedEvidenceRules } = await import("../../src/evidence-rule-bridge.js");
    return runMigratedEvidenceRules(facts, settings, undefined, selectedBuild);
  }

  function viteFacts(overrides: Partial<ProjectFacts> = {}): ProjectFacts {
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
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
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
      ...overrides,
    };
  }

  const devBuild = {
    id: "vite-build-1",
    adapter: "vite" as const,
    bundler: "vite" as const,
    outputRoot: "dist",
    sourceHook: "writeBundle" as const,
    emittedAssets: [],
    effectiveMode: "development" as const,
    artifacts: [],
    capabilities: {
      outputRoot: { state: "exact" as const, reason: "test" },
      emittedAssets: { state: "exact" as const, reason: "test" },
      artifacts: { state: "unavailable" as const, reason: "test" },
      effectiveMode: { state: "exact" as const, reason: "test" },
      target: { state: "exact" as const, reason: "test" },
    },
  };

  it("returns unknown for absent viteConfig and transformImport facts", async () => {
    const migrated = await runMigrated(viteFacts());
    for (const id of [
      "vite/manual-chunks-conflict",
      "vite/alias-share-bypass",
      "vite/server-origin",
      "config/transform-import-share-conflict",
    ] as const) {
      expect(
        migrated.output.evaluations.find((evaluation) => evaluation.rule.id === id),
      ).toMatchObject({ outcome: "unknown", reasonCode: "evidence-inconclusive" });
    }
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/shared-externals-conflict",
      ),
    ).toMatchObject({ outcome: "not-applicable" });
    expect(
      migrated.output.evaluations.find((evaluation) => evaluation.rule.id === "vite/ignore-origin"),
    ).toMatchObject({ outcome: "pass" });
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/virtual-module-dir",
      ),
    ).toMatchObject({ outcome: "pass" });
  });

  it("returns unknown for ignoreOrigin true without a server.origin fact", async () => {
    const facts = viteFacts();
    facts.moduleFederation!.vite!.ignoreOrigin = true;
    const migrated = await runMigrated(facts);
    expect(
      migrated.output.evaluations.find((evaluation) => evaluation.rule.id === "vite/ignore-origin"),
    ).toMatchObject({ outcome: "unknown", reasonCode: "evidence-inconclusive" });

    facts.bundler.viteConfig = { serverOrigin: null };
    const observed = await runMigrated(facts, { "vite/ignore-origin": "info" });
    expect(
      observed.output.evaluations.find((evaluation) => evaluation.rule.id === "vite/ignore-origin"),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });

    facts.moduleFederation!.vite!.virtualModuleDir = "nested/mf";
    const slash = await runMigrated(facts, { "vite/virtual-module-dir": "warning" });
    expect(
      slash.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/virtual-module-dir",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
  });

  it("returns unknown for unobserved webpack externals and fails on overlap", async () => {
    const missing = viteFacts();
    missing.bundler.name = "webpack";
    const unknownRun = await runMigrated(missing);
    expect(
      unknownRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/shared-externals-conflict",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "evidence-inconclusive" });

    const overlap = viteFacts();
    overlap.bundler.name = "webpack";
    overlap.bundler.externals = ["react"];
    const failRun = await runMigrated(overlap, { "config/shared-externals-conflict": "warning" });
    expect(
      failRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/shared-externals-conflict",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
  });

  it("returns unknown for webpack-family function aliases and absent resolve.alias facts", async () => {
    const { runMigratedEvidenceRules } = await import("../../src/evidence-rule-bridge.js");
    const missing = viteFacts({ bundler: { name: "webpack", mode: "ci" } });
    const missingRun = await runMigratedEvidenceRules(missing, {});
    expect(
      missingRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/alias-share-bypass",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "evidence-inconclusive" });

    const fnFacts = viteFacts({
      bundler: { name: "rsbuild", mode: "ci", resolveAliasFunction: true },
    });
    const fnRun = await runMigratedEvidenceRules(fnFacts, {});
    expect(
      fnRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/alias-share-bypass",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "evidence-inconclusive" });

    const overlap = viteFacts({
      bundler: { name: "rspack", mode: "ci", resolveAliases: { react: "./src/shims/react.ts" } },
    });
    const overlapRun = await runMigratedEvidenceRules(overlap, {});
    expect(
      overlapRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/alias-share-bypass",
      ),
    ).toMatchObject({ outcome: "fail" });
  });

  it("returns unknown for absent webpack splitChunks facts", async () => {
    const facts = viteFacts();
    facts.bundler.name = "webpack";
    const migrated = await runMigrated(facts);
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/split-chunks-mf-runtime",
      ),
    ).toMatchObject({ outcome: "unknown", reasonCode: "evidence-inconclusive" });
  });

  it("evaluates SSR Vite rules without adapter builds evidence", async () => {
    const hostInit = viteFacts({
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          catalog: {
            name: "catalog",
            entry: "https://example.test/mf-manifest.json",
            shareScope: "default",
          },
        },
        shared: {},
        vite: {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: [],
          target: "node",
          hostInitInjectLocation: "html",
        },
      },
    });
    const hostInitRun = await runMigrated(hostInit, { "vite/host-init-inject-ssr": "error" });
    expect(
      hostInitRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/host-init-inject-ssr",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      hostInitRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/host-init-inject-ssr",
      )?.reasonCode,
    ).not.toBe("prerequisite-missing");

    const nitro = viteFacts({
      dependencies: { declared: { nitropack: "^2" }, installed: {} },
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
            shareScope: "default",
          },
        },
        shared: {
          react: { package: "react", singleton: true, eager: false, shareScope: ["default"] },
        },
        vite: {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: ["react"],
        },
      },
    });
    const nitroRun = await runMigrated(nitro, { "vite/ssr-nitro-externals": "warning" });
    expect(
      nitroRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/ssr-nitro-externals",
      ),
    ).toMatchObject({ outcome: "fail", completeness: "complete" });
    expect(
      nitroRun.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/ssr-nitro-externals",
      )?.reasonCode,
    ).not.toBe("prerequisite-missing");
  });

  it("marks vite dialect rules not-applicable on rspack", async () => {
    const facts = viteFacts({ bundler: { name: "rspack", mode: "ci" } });
    const migrated = await runMigrated(facts);
    expect(
      migrated.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/remotes-prefer-module",
      ),
    ).toMatchObject({ outcome: "not-applicable" });
  });

  it("uses build effectiveMode only for vite/remote-hmr-dev", async () => {
    const facts = viteFacts({
      moduleFederation: {
        name: "host",
        exposes: {},
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/remoteEntry.js",
            shareScope: ["default"],
          },
        },
        shared: {},
        shareStrategy: "version-first",
        vite: { bundleAllCSS: false, ignoreOrigin: false, ssrExternals: [], remoteHmr: false },
      },
    });
    const withoutBuild = await runMigrated(facts, {
      "vite/remote-hmr-dev": "info",
      "config/remote-localhost-in-production": "warning",
    });
    expect(
      withoutBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/remote-hmr-dev",
      ),
    ).toMatchObject({ outcome: "pass" });
    expect(
      withoutBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/remote-localhost-in-production",
      ),
    ).toMatchObject({ outcome: "fail" });

    const withBuild = await runMigrated(
      facts,
      {
        "vite/remote-hmr-dev": "info",
        "config/remote-localhost-in-production": "warning",
        "reliability/version-first-offline-remotes": ["warning", { localDemoOnly: true }],
      },
      devBuild,
    );
    expect(
      withBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/remote-hmr-dev",
      ),
    ).toMatchObject({ outcome: "fail" });
    expect(
      withBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "config/remote-localhost-in-production",
      ),
    ).toMatchObject({ outcome: "fail" });
    expect(
      withBuild.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "reliability/version-first-offline-remotes",
      ),
    ).toMatchObject({ outcome: "fail" });

    const multiBuildFacts = {
      ...facts,
      builds: [
        { ...devBuild, id: "vite-build-1" },
        {
          ...devBuild,
          id: "vite-build-2",
          outputRoot: "dist/server",
          effectiveMode: "production" as const,
        },
      ],
    };
    const multiBuildDev = await runMigrated(
      multiBuildFacts,
      { "vite/remote-hmr-dev": "info" },
      multiBuildFacts.builds![0],
    );
    expect(
      multiBuildDev.output.evaluations.find(
        (evaluation) => evaluation.rule.id === "vite/remote-hmr-dev",
      ),
    ).toMatchObject({ outcome: "pass" });
  });

  it("keeps doctor/partial-analysis on unknown confidence while projecting capability gaps", async () => {
    const facts = viteFacts({
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
      },
    });
    const migrated = await runMigrated(facts, { "doctor/partial-analysis": "warning" });
    const evaluation = migrated.output.evaluations.find(
      (item) => item.rule.id === "doctor/partial-analysis",
    );
    expect(evaluation).toMatchObject({ outcome: "fail", confidence: "unknown" });
    const { projectMigratedFailures } = await import("../../src/evidence-rule-bridge.js");
    const projected = projectMigratedFailures(
      migrated.output.evaluations,
      facts,
      { "doctor/partial-analysis": "warning" },
      ".",
    );
    expect(projected.some((finding) => finding.ruleId === "doctor/partial-analysis")).toBe(true);
  });

  it("evaluates doctor/partial-analysis without moduleFederation evidence", async () => {
    const facts = viteFacts();
    delete facts.moduleFederation;
    facts.capabilities.config = false;
    const migrated = await runMigrated(facts, { "doctor/partial-analysis": "warning" });
    const evaluation = migrated.output.evaluations.find(
      (item) => item.rule.id === "doctor/partial-analysis",
    );
    expect(evaluation).toMatchObject({ outcome: "fail", confidence: "unknown" });
    expect(evaluation?.reasonCode).not.toBe("prerequisite-missing");
  });
});

describe("config/copied-webpack-options-on-vite", () => {
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
        filename: "remoteEntry.js",
        exposes: { "./Widget": "src/Widget.ts" },
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
        shareStrategy: "version-first",
        vite: {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: [],
          target: "web",
          disableRemote: false,
        },
      },
      dependencies: { declared: { "@module-federation/vite": "1.19.1" }, installed: {} },
      imports: {
        sourceFiles: ["src/Widget.ts"],
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

  async function run(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find(
      (item) => item.meta.id === "config/copied-webpack-options-on-vite",
    )!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("stays quiet on a valid Vite MF config", async () => {
    expect(await run(baseFacts())).toHaveLength(0);
  });

  it("stays quiet on webpack even when webpack-only keys are present", async () => {
    const facts = baseFacts("webpack");
    facts.moduleFederation!.remoteType = "script";
    facts.moduleFederation!.virtualRuntimeEntry = true;
    facts.moduleFederation!.runtime = false;
    facts.moduleFederation!.async = true;
    facts.moduleFederation!.experiments = {
      asyncStartup: true,
      externalRuntime: false,
      provideExternalRuntime: false,
      disableRemote: true,
      target: "node",
    };
    expect(await run(facts)).toHaveLength(0);
  });

  it("flags webpack-only keys and lists Vite equivalents", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remoteType = "script";
    facts.moduleFederation!.virtualRuntimeEntry = true;
    facts.moduleFederation!.runtime = false;
    facts.moduleFederation!.async = { eager: /./ };
    facts.moduleFederation!.experiments = {
      asyncStartup: true,
      externalRuntime: false,
      provideExternalRuntime: false,
      disableRemote: true,
      disableShared: false,
      disableSnapshot: true,
      target: "node",
    };
    const findings = await run(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      message: expect.stringContaining("remoteType"),
      evidence: {
        keys: expect.arrayContaining([
          "remoteType",
          "virtualRuntimeEntry",
          "runtime",
          "async",
          "experiments.asyncStartup",
          "experiments.optimization.disableRemote",
          "experiments.optimization.disableShared",
          "experiments.optimization.disableSnapshot",
          "experiments.optimization.target",
        ]),
        equivalents: {
          remoteType: "remotes.<name>.type",
          virtualRuntimeEntry: null,
          runtime: null,
          async: null,
          "experiments.asyncStartup": null,
          "experiments.optimization.disableRemote": "disableRemote",
          "experiments.optimization.disableShared": "disableShared",
          "experiments.optimization.disableSnapshot": "disableSnapshot",
          "experiments.optimization.target": "target",
        },
      },
    });
  });

  it("fires through analyze when webpack options are pasted onto Vite", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/mf-manifest.json",
            type: "module",
          },
        },
        remoteType: "script",
        virtualRuntimeEntry: true,
        runtime: false,
        async: true,
        experiments: {
          asyncStartup: true,
          optimization: {
            disableRemote: true,
            target: "node",
          },
        },
        publicPath: "auto",
        target: "web",
      },
      rules: {
        "doctor/partial-analysis": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/remote-entry-missing": "off",
        "config/plugin-package-mismatch": "off",
        "config/remote-capability-disabled": "off",
        "config/remote-localhost-in-production": "off",
        "vite/host-init-inject-ssr": "off",
        "reliability/async-startup-library-promise": "off",
      },
    });
    const finding = result.report.findings.find(
      (item) => item.ruleId === "config/copied-webpack-options-on-vite",
    );
    expect(finding).toMatchObject({
      severity: "warning",
      evidence: {
        keys: expect.arrayContaining([
          "remoteType",
          "virtualRuntimeEntry",
          "runtime",
          "async",
          "experiments.asyncStartup",
          "experiments.optimization.disableRemote",
          "experiments.optimization.target",
        ]),
      },
    });
  });

  it("skips through analyze on webpack even when webpack-only keys are present", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/mf-manifest.json",
          },
        },
        remoteType: "script",
        virtualRuntimeEntry: true,
        runtime: false,
        async: true,
        experiments: {
          asyncStartup: true,
          optimization: {
            disableRemote: true,
            target: "node",
          },
        },
      },
      rules: {
        "doctor/partial-analysis": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/remote-entry-missing": "off",
        "config/plugin-package-mismatch": "off",
        "config/remote-capability-disabled": "off",
        "config/remote-localhost-in-production": "off",
      },
    });
    expect(result.report.findings.map((item) => item.ruleId)).not.toContain(
      "config/copied-webpack-options-on-vite",
    );
  });

  it("stays quiet through analyze for a valid Vite config", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/mf-manifest.json",
            type: "module",
          },
        },
        publicPath: "auto",
        target: "web",
        disableRemote: false,
        manifest: true,
      },
      rules: {
        "doctor/partial-analysis": "off",
        "artifact/types-missing": "off",
        "artifact/types-metadata-missing": "off",
        "artifact/remote-entry-missing": "off",
        "artifact/manifest-invalid": "off",
        "artifact/manifest-name-mismatch": "off",
        "artifact/manifest-remote-entry-missing": "off",
        "artifact/manifest-expose-assets-empty": "off",
        "config/plugin-package-mismatch": "off",
        "config/remote-localhost-in-production": "off",
      },
    });
    expect(
      result.report.findings.some(
        (item) => item.ruleId === "config/copied-webpack-options-on-vite",
      ),
    ).toBe(false);
  });
});

describe("config/copied-vite-options-on-webpack", () => {
  const webpackFamily = ["webpack", "rspack", "rsbuild", "modern"] as const;
  const viteOnlyKeys = {
    bundleAllCSS: true,
    ignoreOrigin: false,
    ssrExternals: [] as string[],
    virtualModuleDir: "__mf__",
    hostInitInjectLocation: "entry" as const,
    remoteHmr: true,
    varFilename: "remoteEntry.js",
  };

  function baseFacts(bundler: ProjectFacts["bundler"]["name"] = "webpack"): ProjectFacts {
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
        filename: "remoteEntry.js",
        exposes: { "./Widget": "src/Widget.ts" },
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
        shareStrategy: "version-first",
        vite: {
          bundleAllCSS: false,
          ignoreOrigin: false,
          ssrExternals: [],
          target: "web",
          disableRemote: false,
        },
      },
      dependencies: { declared: { "@module-federation/enhanced": "2.8.2" }, installed: {} },
      imports: {
        sourceFiles: ["src/Widget.ts"],
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

  async function run(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find(
      (item) => item.meta.id === "config/copied-vite-options-on-webpack",
    )!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  const analyzeQuietRules = {
    "doctor/partial-analysis": "off" as const,
    "artifact/types-missing": "off" as const,
    "artifact/types-metadata-missing": "off" as const,
    "artifact/remote-entry-missing": "off" as const,
    "config/plugin-package-mismatch": "off" as const,
    "config/remote-localhost-in-production": "off" as const,
    "performance/vite-bundle-all-css": "off" as const,
    "vite/host-init-inject-ssr": "off" as const,
    "vite/remote-hmr-dev": "off" as const,
    "vite/var-filename-interop": "off" as const,
    "vite/remotes-prefer-module": "off" as const,
  };

  it.each(webpackFamily)(
    "stays quiet on %s when no Vite-only keys are present",
    async (bundler) => {
      expect(await run(baseFacts(bundler))).toHaveLength(0);
    },
  );

  it("stays quiet on Vite even when Vite-only keys are present", async () => {
    const facts = baseFacts("vite");
    facts.moduleFederation!.vite = { ...viteOnlyKeys };
    expect(await run(facts)).toHaveLength(0);
  });

  it("stays quiet when bundler detection is unknown", async () => {
    const facts = baseFacts("unknown");
    facts.moduleFederation!.vite = { ...viteOnlyKeys };
    expect(await run(facts)).toHaveLength(0);
  });

  it.each(webpackFamily)("flags Vite-only keys on %s and lists them", async (bundler) => {
    const facts = baseFacts(bundler);
    facts.moduleFederation!.vite = { ...viteOnlyKeys };
    const findings = await run(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      message: expect.stringContaining("virtualModuleDir"),
      evidence: {
        keys: [
          "virtualModuleDir",
          "hostInitInjectLocation",
          "bundleAllCSS",
          "remoteHmr",
          "varFilename",
        ],
      },
    });
  });

  it("lists only the Vite-only keys that are present", async () => {
    const facts = baseFacts("webpack");
    facts.moduleFederation!.vite = {
      bundleAllCSS: false,
      ignoreOrigin: false,
      ssrExternals: [],
      virtualModuleDir: "__mf__",
      remoteHmr: false,
    };
    const findings = await run(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toEqual({
      keys: ["virtualModuleDir", "remoteHmr"],
    });
  });

  it("does not treat defaulted bundleAllCSS false as a copied Vite key", async () => {
    const facts = baseFacts("webpack");
    facts.moduleFederation!.vite = {
      bundleAllCSS: false,
      ignoreOrigin: false,
      ssrExternals: [],
    };
    expect(await run(facts)).toHaveLength(0);
  });

  it("fires through analyze when Vite keys are pasted onto webpack", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/mf-manifest.json",
          },
        },
        virtualModuleDir: "__mf__",
        hostInitInjectLocation: "entry",
        bundleAllCSS: true,
        remoteHmr: true,
        varFilename: "remoteEntry.js",
      },
      rules: analyzeQuietRules,
    });
    const finding = result.report.findings.find(
      (item) => item.ruleId === "config/copied-vite-options-on-webpack",
    );
    expect(finding).toMatchObject({
      severity: "warning",
      evidence: {
        keys: [
          "virtualModuleDir",
          "hostInitInjectLocation",
          "bundleAllCSS",
          "remoteHmr",
          "varFilename",
        ],
      },
    });
  });

  it("fires through analyze on rspack when Vite keys are present", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "rspack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/mf-manifest.json",
          },
        },
        virtualModuleDir: "__mf__",
        bundleAllCSS: true,
      },
      rules: analyzeQuietRules,
    });
    expect(
      result.report.findings.find((item) => item.ruleId === "config/copied-vite-options-on-webpack")
        ?.evidence,
    ).toEqual({ keys: ["virtualModuleDir", "bundleAllCSS"] });
  });

  it("stays quiet through analyze on webpack when no Vite-only keys are present", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/mf-manifest.json",
          },
        },
        remoteType: "script",
      },
      rules: analyzeQuietRules,
    });
    expect(result.report.findings.map((item) => item.ruleId)).not.toContain(
      "config/copied-vite-options-on-webpack",
    );
  });

  it("stays quiet through analyze for a Vite config that uses Vite-only keys", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          shop: {
            name: "shop",
            entry: "http://localhost:4174/mf-manifest.json",
            type: "module",
          },
        },
        virtualModuleDir: "__mf__",
        hostInitInjectLocation: "entry",
        bundleAllCSS: true,
        remoteHmr: true,
        varFilename: "remoteEntry.js",
        publicPath: "auto",
        target: "web",
        manifest: true,
      },
      rules: {
        ...analyzeQuietRules,
        "artifact/manifest-invalid": "off",
        "artifact/manifest-name-mismatch": "off",
        "artifact/manifest-remote-entry-missing": "off",
        "artifact/manifest-expose-assets-empty": "off",
      },
    });
    expect(
      result.report.findings.some(
        (item) => item.ruleId === "config/copied-vite-options-on-webpack",
      ),
    ).toBe(false);
  });
});

describe("config/async-startup-rspack-version", () => {
  const quietRules = {
    "doctor/partial-analysis": "off" as const,
    "config/plugin-package-mismatch": "off" as const,
    "artifact/remote-entry-missing": "off" as const,
    "artifact/types-missing": "off" as const,
    "artifact/types-metadata-missing": "off" as const,
    "artifact/dts-disabled": "off" as const,
    "artifact/manifest-disabled": "off" as const,
    "shared/candidate": "off" as const,
  };

  function experiments(asyncStartup: boolean) {
    return { asyncStartup, externalRuntime: false, provideExternalRuntime: false };
  }

  function baseFacts(
    bundler: ProjectFacts["bundler"]["name"],
    options: {
      asyncStartup?: boolean;
      version?: string;
      installed?: string;
    } = {},
  ): ProjectFacts {
    const asyncStartup = options.asyncStartup ?? true;
    return {
      schemaVersion: 1,
      project: { name: "fixture", root: "." },
      bundler: {
        name: bundler,
        mode: "ci",
        ...(options.version ? { version: options.version } : {}),
      },
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
        filename: "remoteEntry.js",
        exposes: { "./Widget": "src/Widget.ts" },
        remotes: {},
        shared: {},
        experiments: experiments(asyncStartup),
      },
      dependencies: {
        declared: { "@module-federation/enhanced": "2.8.2" },
        installed: options.installed ? { "@rspack/core": options.installed } : {},
      },
      imports: {
        sourceFiles: ["src/Widget.ts"],
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

  async function run(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find(
      (item) => item.meta.id === "config/async-startup-rspack-version",
    )!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("flags Rspack 1.7.4 and below when asyncStartup is enabled", async () => {
    const findings = await run(baseFacts("rspack", { version: "1.7.4" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      message: expect.stringContaining("1.7.4"),
      evidence: {
        bundler: "rspack",
        version: "1.7.4",
        package: "@rspack/core",
        minimumExclusive: "1.7.4",
      },
      suggestion: expect.stringContaining("greater than 1.7.4"),
    });
  });

  it("stays quiet on Rspack versions greater than 1.7.4", async () => {
    expect(await run(baseFacts("rspack", { version: "1.7.5" }))).toHaveLength(0);
    expect(await run(baseFacts("rspack", { version: "1.8.0" }))).toHaveLength(0);
  });

  it("uses installed @rspack/core on Rsbuild rather than @rsbuild/core", async () => {
    const old = await run(baseFacts("rsbuild", { version: "1.3.0", installed: "1.7.4" }));
    expect(old).toHaveLength(1);
    expect(old[0]?.evidence).toMatchObject({ bundler: "rsbuild", version: "1.7.4" });

    const supported = await run(baseFacts("rsbuild", { version: "1.3.0", installed: "1.7.5" }));
    expect(supported).toHaveLength(0);
  });

  it("does not treat an unknown Rsbuild core version as Rspack 1.7.4", async () => {
    // @rsbuild/core 1.3.0 is not comparable to the Rspack cutoff.
    expect(await run(baseFacts("rsbuild", { version: "1.3.0" }))).toHaveLength(0);
  });

  it("stays quiet when asyncStartup is off or the bundler is not Rspack-family", async () => {
    expect(await run(baseFacts("rspack", { asyncStartup: false, version: "1.6.0" }))).toHaveLength(
      0,
    );
    expect(await run(baseFacts("webpack", { version: "5.90.0" }))).toHaveLength(0);
    expect(await run(baseFacts("vite", { version: "6.0.0" }))).toHaveLength(0);
  });

  it("skips rather than inventing a mismatch when the Rspack version is missing", async () => {
    expect(await run(baseFacts("rspack"))).toHaveLength(0);
  });

  it("reports through analyze when bundlerVersion is 1.7.4", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "rspack",
      bundlerVersion: "1.7.4",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        experiments: { asyncStartup: true },
        exposes: { "./Widget": "./src/index.ts" },
      },
      rules: quietRules,
    });
    expect(result.facts.bundler.version).toBe("1.7.4");
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "config/async-startup-rspack-version" }),
      ]),
    );
  });

  it("resolves nested @rspack/core for Rsbuild projects", async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, "node_modules/@rspack/core"), { recursive: true });
    await fs.writeFile(
      path.join(root, "node_modules/@rspack/core/package.json"),
      JSON.stringify({ name: "@rspack/core", version: "1.7.4", main: "index.js" }),
    );
    await fs.writeFile(
      path.join(root, "node_modules/@rspack/core/index.js"),
      "module.exports = {};\n",
    );
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        dependencies: { "@rsbuild/core": "1.3.0" },
      }),
    );
    const result = await analyze({
      root,
      bundler: "rsbuild",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        experiments: { asyncStartup: true },
        exposes: { "./Widget": "./src/index.ts" },
      },
      rules: quietRules,
    });
    expect(result.facts.dependencies.installed["@rspack/core"]).toBe("1.7.4");
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "config/async-startup-rspack-version" }),
      ]),
    );
  });
});

describe("shared/package-path-missing", () => {
  const quietRules = {
    "doctor/partial-analysis": "off" as const,
    "config/plugin-package-mismatch": "off" as const,
    "artifact/remote-entry-missing": "off" as const,
    "artifact/types-missing": "off" as const,
    "artifact/types-metadata-missing": "off" as const,
    "artifact/dts-disabled": "off" as const,
    "artifact/manifest-disabled": "off" as const,
    "shared/candidate": "off" as const,
    "shared/unused": "off" as const,
  };

  it("flags a packagePath that is missing on disk", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        shared: {
          react: { singleton: true, packagePath: "./vendor/react" },
        },
      },
      rules: quietRules,
    });
    expect(result.facts.moduleFederation?.shared.react?.packagePath).toBe("./vendor/react");
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "shared/package-path-missing",
          evidence: expect.objectContaining({
            package: "react",
            packagePath: "./vendor/react",
          }),
        }),
      ]),
    );
  });

  it("stays quiet when packagePath exists on disk", async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, "vendor", "react"), { recursive: true });
    await fs.writeFile(
      path.join(root, "vendor", "react", "package.json"),
      JSON.stringify({ name: "react", version: "19.1.1" }),
    );
    const result = await analyze({
      root,
      bundler: "webpack",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        shared: {
          react: { singleton: true, packagePath: "./vendor/react" },
        },
      },
      rules: quietRules,
    });
    expect(result.facts.moduleFederation?.shared.react?.packagePath).toBe("./vendor/react");
    expect(
      result.report.findings.some((item) => item.ruleId === "shared/package-path-missing"),
    ).toBe(false);
  });

  it("skips unknown bundlers instead of inventing a disk finding", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "unknown",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        shared: {
          react: { singleton: true, packagePath: "./vendor/react" },
        },
      },
      rules: quietRules,
    });
    expect(
      result.report.findings.some((item) => item.ruleId === "shared/package-path-missing"),
    ).toBe(false);
  });

  it("skips URL-like packagePath rather than claiming a missing file", async () => {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "shared/package-path-missing")!;
    await rule.check({
      facts: {
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
          name: "host",
          exposes: {},
          remotes: {},
          shared: {
            react: {
              package: "react",
              singleton: true,
              eager: false,
              shareScope: ["default"],
              packagePath: "virtual:shared/react",
            },
          },
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
      },
      options: {},
      root: "/tmp",
      report: (finding) => findings.push(finding),
    });
    expect(findings).toHaveLength(0);
  });
});

describe("config/hashed-remote-filename", () => {
  function baseFacts(bundler: ProjectFacts["bundler"]["name"] = "webpack"): ProjectFacts {
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
        name: "remote",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "src/Widget.ts" },
        remotes: {},
        shared: {},
      },
      dependencies: { declared: { "@module-federation/enhanced": "1.0.0" }, installed: {} },
      imports: {
        sourceFiles: ["src/Widget.ts"],
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

  async function run(facts: ProjectFacts, options: Record<string, unknown> = {}) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find((item) => item.meta.id === "config/hashed-remote-filename")!;
    await rule.check({ facts, options, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("warns when webpack Module Federation filename uses [contenthash]", async () => {
    const facts = baseFacts("webpack");
    facts.moduleFederation!.filename = "remoteEntry.[contenthash].js";
    expect(await run(facts)).toEqual([
      expect.objectContaining({
        message: "Hashed remote entry filenames break stable consumer URLs.",
        evidence: { filename: "remoteEntry.[contenthash].js" },
      }),
    ]);
  });

  it("warns when rspack Module Federation filename uses [hash]", async () => {
    const facts = baseFacts("rspack");
    facts.moduleFederation!.filename = "static/js/remoteEntry.[hash:8].js";
    expect(await run(facts)).not.toHaveLength(0);
  });

  it("warns when observed output.filename is hashed and MF filename is unset", async () => {
    const facts = baseFacts("webpack");
    delete facts.moduleFederation!.filename;
    facts.bundler.outputFilename = "[name].[contenthash].js";
    expect(await run(facts)).toEqual([
      expect.objectContaining({
        evidence: { outputFilename: "[name].[contenthash].js" },
      }),
    ]);
  });

  it("stays quiet when MF filename is a stable override of hashed output.filename", async () => {
    const facts = baseFacts("webpack");
    facts.moduleFederation!.filename = "remoteEntry.js";
    facts.bundler.outputFilename = "[name].[contenthash].js";
    expect(await run(facts)).toHaveLength(0);
  });

  it("stays quiet on Vite (vite/hashed-remote-filename owns that dialect)", async () => {
    const facts = baseFacts("vite");
    facts.moduleFederation!.filename = "remoteEntry.[hash].js";
    expect(await run(facts)).toHaveLength(0);
  });

  it("honors hashedFilenameMode allow", async () => {
    const facts = baseFacts("webpack");
    facts.moduleFederation!.filename = "remoteEntry.[contenthash].js";
    expect(await run(facts, { hashedFilenameMode: "allow" })).toHaveLength(0);
  });
});

describe("config/nested-producer-dts-extract", () => {
  const quietRules = {
    "doctor/partial-analysis": "off" as const,
    "config/plugin-package-mismatch": "off" as const,
    "artifact/remote-entry-missing": "off" as const,
    "artifact/types-missing": "off" as const,
    "artifact/types-metadata-missing": "off" as const,
    "artifact/manifest-invalid": "off" as const,
    "artifact/manifest-name-mismatch": "off" as const,
    "artifact/manifest-remote-entry-missing": "off" as const,
    "artifact/manifest-expose-assets-empty": "off" as const,
    "config/remote-localhost-in-production": "off" as const,
    "reliability/version-first-offline-remotes": "off" as const,
    "shared/candidate": "off" as const,
  };

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
        name: "nested_remote",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "src/Widget.ts" },
        remotes: {
          leaf: {
            name: "leaf",
            entry: "https://example.test/leaf/mf-manifest.json",
            shareScope: "default",
          },
        },
        shared: {},
        dts: { enabled: true, options: {} },
      },
      dependencies: { declared: {}, installed: {} },
      imports: {
        sourceFiles: ["src/Widget.ts"],
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

  async function run(facts: ProjectFacts) {
    const findings: Array<
      Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
    > = [];
    const rule = builtInRules.find(
      (item) => item.meta.id === "config/nested-producer-dts-extract",
    )!;
    await rule.check({ facts, options: {}, report: (finding) => findings.push(finding) });
    return findings;
  }

  it("warns when a remote exposes and consumes remotes with dts on and extractRemoteTypes false", async () => {
    const findings = await run(baseFacts());
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("extractRemoteTypes"),
        evidence: expect.objectContaining({
          extractRemoteTypes: false,
          exposes: ["./Widget"],
          remotes: ["leaf"],
        }),
      }),
    ]);
  });

  it("skips host-only consumers that do not expose", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.exposes = {};
    expect(await run(facts)).toHaveLength(0);
  });

  it("skips leaf producers that do not consume remotes", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.remotes = {};
    expect(await run(facts)).toHaveLength(0);
  });

  it("skips when extractRemoteTypes is enabled", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.dts = {
      enabled: true,
      options: { generateTypes: { extractRemoteTypes: true } },
    };
    expect(await run(facts)).toHaveLength(0);
  });

  it("skips when dts is disabled", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.dts = { enabled: false, options: {} };
    expect(await run(facts)).toHaveLength(0);
  });

  it("skips when generateTypes is explicitly false", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.dts = { enabled: true, options: { generateTypes: false } };
    expect(await run(facts)).toHaveLength(0);
  });

  it("fires through analyze for a nested producer without extractRemoteTypes", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "nested_remote",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          leaf: {
            name: "leaf",
            entry: "https://example.test/leaf/mf-manifest.json",
          },
        },
        dts: true,
      },
      rules: quietRules,
    });
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "config/nested-producer-dts-extract",
          severity: "warning",
        }),
      ]),
    );
  });

  it("stays quiet through analyze for a host-only consumer", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "host",
        remotes: {
          leaf: {
            name: "leaf",
            entry: "https://example.test/leaf/mf-manifest.json",
          },
        },
        dts: true,
      },
      rules: quietRules,
    });
    expect(
      result.report.findings.some((item) => item.ruleId === "config/nested-producer-dts-extract"),
    ).toBe(false);
  });

  it("stays quiet through analyze when extractRemoteTypes is enabled", async () => {
    const root = await fixture();
    const result = await analyze({
      root,
      bundler: "vite",
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: "nested_remote",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/index.ts" },
        remotes: {
          leaf: {
            name: "leaf",
            entry: "https://example.test/leaf/mf-manifest.json",
          },
        },
        dts: { generateTypes: { extractRemoteTypes: true } },
      },
      rules: quietRules,
    });
    expect(
      result.report.findings.some((item) => item.ruleId === "config/nested-producer-dts-extract"),
    ).toBe(false);
  });
});
