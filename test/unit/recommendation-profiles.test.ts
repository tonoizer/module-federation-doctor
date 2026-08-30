import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";

function baseFacts(): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: "recommendation-fixture", root: "." },
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
      deepImports: [],
      deepImportFiles: {},
    },
    artifacts: { emittedAssets: [] },
  };
}

async function run(
  id: string,
  facts: ProjectFacts,
  options: Record<string, unknown> = {},
): Promise<
  Array<Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">>
> {
  const findings: Array<
    Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
  > = [];
  const rule = builtInRules.find((item) => item.meta.id === id);
  if (!rule) throw new Error(`Missing test rule ${id}`);
  await rule.check({ facts, options, report: (finding) => findings.push(finding) });
  return findings;
}

describe("issue #133 recommendation nudges", () => {
  it("keeps the Observability recommendation opt-in by default", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/enhanced"] = "2.8.0";

    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(0);

    facts.dependencies.declared["@module-federation/observability-plugin"] = "2.8.0";
    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(1);

    facts.moduleFederation!.runtimePlugins = ["@module-federation/observability-plugin"];
    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(0);
  });

  it("recognizes runtime/node registration but not the build-only entry", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/enhanced"] = "2.8.0";
    facts.dependencies.declared["@module-federation/observability-plugin"] = "2.8.0";

    facts.moduleFederation!.runtimePlugins = ["@module-federation/observability-plugin/build"];
    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(1);

    facts.moduleFederation!.runtimePlugins = ["@module-federation/observability-plugin/node"];
    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(0);

    facts.moduleFederation!.runtimePlugins = [
      "C:/workspace/node_modules/@module-federation/observability-plugin/dist/node.js",
    ];
    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(0);

    facts.moduleFederation!.runtimePlugins = [
      "C:/workspace/node_modules/@module-federation/observability-plugin/package.json",
    ];
    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(1);

    facts.moduleFederation!.runtimePlugins = [];
    facts.imports.specifiers = ["@module-federation/observability-plugin/build"];
    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(1);
    facts.imports.specifiers = ["@module-federation/observability-plugin"];
    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(0);
  });

  it("requires the supported MF 2.5 floor and can be widened by production options", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/enhanced"] = "2.4.9";
    expect(
      await run("config/observability-plugin-recommended", facts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(0);

    facts.dependencies.declared["@module-federation/enhanced"] = "2.5.0";
    expect(
      await run("config/observability-plugin-recommended", facts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(1);

    facts.dependencies.declared["@module-federation/enhanced"] = "^1.0.0 || ^2.5.0";
    expect(
      await run("config/observability-plugin-recommended", facts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(1);

    facts.dependencies.declared["@module-federation/enhanced"] = "workspace:^2.5.0";
    expect(
      await run("config/observability-plugin-recommended", facts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(1);

    facts.dependencies.installed["@module-federation/enhanced"] = "2.4.9";
    expect(
      await run("config/observability-plugin-recommended", facts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(0);
  });

  it("does not recommend for an unsupported prerelease exact version", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/enhanced"] = "2.6.0-beta.1";
    expect(
      await run("config/observability-plugin-recommended", facts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(0);
  });

  it.each([
    ">=2.6.0-beta.1 <2.6.0",
    "2.6.0-beta.1 - 2.6.0-beta.1",
    ">=2.6.0-0 <2.6.0",
    ">=2.6.0-beta.1 <2.6.0 || 2.4.9",
  ])("does not recommend for a range without a stable supported version: %s", async (version) => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/enhanced"] = version;
    expect(
      await run("config/observability-plugin-recommended", facts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(0);
  });

  it.each([">=2.6.0-beta.1 <2.7.0", ">2.5.0 <2.6.0", ">=2.5.0-0 <2.6.0"])(
    "accepts a range that includes a stable supported version: %s",
    async (version) => {
      const facts = baseFacts();
      facts.dependencies.declared["@module-federation/enhanced"] = version;
      expect(
        await run("config/observability-plugin-recommended", facts, {
          recommendWithoutPackage: true,
        }),
      ).toHaveLength(1);
    },
  );

  it.each(["x", "X", "workspace:x", "*", "workspace:*"])(
    "does not treat %s dependency ranges as supported MF versions",
    async (version) => {
      const facts = baseFacts();
      facts.dependencies.declared["@module-federation/enhanced"] = version;
      expect(
        await run("config/observability-plugin-recommended", facts, {
          recommendWithoutPackage: true,
        }),
      ).toHaveLength(0);
    },
  );

  it("prefers an exact installed version over a declared wildcard", async () => {
    const supportedFacts = baseFacts();
    supportedFacts.dependencies.declared["@module-federation/enhanced"] = "*";
    supportedFacts.dependencies.installed["@module-federation/enhanced"] = "2.5.0";
    expect(
      await run("config/observability-plugin-recommended", supportedFacts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(1);

    const unsupportedFacts = baseFacts();
    unsupportedFacts.dependencies.declared["@module-federation/enhanced"] = "*";
    unsupportedFacts.dependencies.installed["@module-federation/enhanced"] = "2.4.9";
    expect(
      await run("config/observability-plugin-recommended", unsupportedFacts, {
        recommendWithoutPackage: true,
      }),
    ).toHaveLength(0);
  });

  it("fails CI on React prefix-share errors while soft recommendations stay informational", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-issue-133-"));
    try {
      await fs.mkdir(path.join(root, "src"));
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "recommendation-fixture",
          dependencies: {
            react: "19.0.0",
            "@module-federation/enhanced": "2.8.0",
            "@module-federation/observability-plugin": "2.8.0",
          },
        }),
      );
      await fs.writeFile(
        path.join(root, "src/App.ts"),
        'import { jsx } from "react/jsx-runtime";\nexport const App = () => jsx("div", {});\n',
      );

      const result = await analyze({
        root,
        bundler: "vite",
        mode: "ci",
        output: { formats: [] },
        moduleFederation: {
          name: "host",
          exposes: { "./App": "src/App.ts" },
          shared: { react: { singleton: true } },
        },
        rules: {
          "config/plugin-package-mismatch": "off",
          "doctor/partial-analysis": "off",
          "artifact/types-missing": "off",
          "artifact/types-metadata-missing": "off",
          "artifact/remote-entry-missing": "off",
          "shared/unused": "off",
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.report.findings).toContainEqual(
        expect.objectContaining({
          ruleId: "config/observability-plugin-recommended",
          severity: "info",
        }),
      );
      expect(result.report.findings).toContainEqual(
        expect.objectContaining({ ruleId: "shared/prefix-share-recommended", severity: "error" }),
      );

      const production = await analyze({
        root,
        bundler: "vite",
        mode: "ci",
        profile: "production",
        output: { formats: [] },
        moduleFederation: {
          name: "host",
          exposes: { "./App": "src/App.ts" },
          shared: { react: { singleton: true } },
        },
        rules: {
          "config/plugin-package-mismatch": "off",
          "doctor/partial-analysis": "off",
          "artifact/types-missing": "off",
          "artifact/types-metadata-missing": "off",
          "artifact/remote-entry-missing": "off",
          "shared/unused": "off",
        },
      });
      expect(production.report.findings).toContainEqual(
        expect.objectContaining({
          ruleId: "config/observability-plugin-recommended",
          severity: "warning",
        }),
      );
      expect(production.report.findings).toContainEqual(
        expect.objectContaining({ ruleId: "shared/prefix-share-recommended", severity: "error" }),
      );
      expect(production.exitCode).toBe(1);

      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "recommendation-fixture",
          dependencies: {
            react: "19.0.0",
            "@module-federation/enhanced": "x",
          },
        }),
      );
      await fs.mkdir(path.join(root, "node_modules/@module-federation/enhanced"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(root, "node_modules/@module-federation/enhanced/package.json"),
        JSON.stringify({ name: "@module-federation/enhanced", version: "x", main: "index.js" }),
      );
      await fs.writeFile(path.join(root, "node_modules/@module-federation/enhanced/index.js"), "");
      const wildcardProduction = await analyze({
        root,
        bundler: "vite",
        mode: "ci",
        profile: "production",
        output: { formats: [] },
        moduleFederation: {
          name: "host",
          exposes: { "./App": "src/App.ts" },
          shared: { react: { singleton: true } },
        },
        rules: {
          "config/plugin-package-mismatch": "off",
          "doctor/partial-analysis": "off",
          "artifact/types-missing": "off",
          "artifact/types-metadata-missing": "off",
          "artifact/remote-entry-missing": "off",
          "shared/unused": "off",
        },
      });
      expect(wildcardProduction.report.findings).not.toContainEqual(
        expect.objectContaining({ ruleId: "config/observability-plugin-recommended" }),
      );
      expect(wildcardProduction.report.findings).toContainEqual(
        expect.objectContaining({ ruleId: "shared/prefix-share-recommended", severity: "error" }),
      );
      expect(wildcardProduction.exitCode).toBe(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("nudges React prefix shares once per package and respects exact/prefix coverage", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.shared = {
      react: { package: "react", singleton: true, eager: false, shareScope: "default" },
      "react-dom": { package: "react-dom", singleton: true, eager: false, shareScope: "default" },
    };
    facts.imports.specifiers = ["react/jsx-runtime", "react-dom/client"];
    facts.imports.deepImports = ["react/jsx-runtime", "react-dom/client"];
    facts.imports.deepImportFiles = {
      react: ["src/Widget.ts"],
      "react-dom": ["src/Widget.ts"],
    };

    const findings = await run("shared/prefix-share-recommended", facts);
    expect(findings).toHaveLength(2);
    expect(
      builtInRules.find((rule) => rule.meta.id === "shared/prefix-share-recommended")?.meta
        .defaultSeverity,
    ).toBe("error");
    expect(findings.map((finding) => finding.evidence.package)).toEqual(["react", "react-dom"]);
    expect(await run("shared/deep-import-bypass", facts)).toHaveLength(0);

    facts.moduleFederation!.shared["react/"] = {
      package: "react/",
      singleton: true,
      eager: false,
      shareScope: "default",
    };
    facts.moduleFederation!.shared["react-dom/client"] = {
      package: "react-dom/client",
      singleton: true,
      eager: false,
      shareScope: "default",
    };
    facts.imports.deepImports = ["react/custom", "react-dom/client"];
    expect(await run("shared/prefix-share-recommended", facts)).toHaveLength(0);
    expect(await run("shared/deep-import-bypass", facts)).toHaveLength(0);
  });

  it("leaves the Bridge prefix contract to its dedicated error rule", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
    facts.imports.specifiers = ["@module-federation/bridge-react/v19", "react-dom/client"];
    facts.imports.deepImports = ["react-dom/client", "react-dom/test-utils"];
    facts.moduleFederation!.shared = {
      "react-dom": {
        package: "react-dom",
        singleton: true,
        eager: false,
        shareScope: "default",
      },
    };

    expect(await run("shared/prefix-share-recommended", facts)).toHaveLength(0);
    expect(await run("shared/deep-import-bypass", facts)).toHaveLength(0);
  });

  it("keeps the prefix advisory for a bare Bridge entry without a dedicated major", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
    facts.imports.specifiers = ["@module-federation/bridge-react", "react-dom/test-utils"];
    facts.imports.deepImports = ["react-dom/test-utils"];
    facts.moduleFederation!.shared = {
      "react-dom": {
        package: "react-dom",
        singleton: true,
        eager: false,
        shareScope: "default",
      },
    };

    expect(await run("shared/prefix-share-recommended", facts)).toHaveLength(1);
    expect(await run("shared/deep-import-bypass", facts)).toHaveLength(0);
  });

  it("keeps non-Bridge React deep-import guidance when Bridge is present", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/bridge-react"] = "0.2.0";
    facts.imports.specifiers = ["@module-federation/bridge-react/v19", "react/custom"];
    facts.imports.deepImports = ["react/custom"];
    facts.moduleFederation!.shared = {
      react: {
        package: "react",
        singleton: true,
        eager: false,
        shareScope: "default",
      },
    };

    expect(await run("shared/prefix-share-recommended", facts)).toHaveLength(1);
    expect(await run("shared/deep-import-bypass", facts)).toHaveLength(0);
  });

  it("does not infer missing registration from incomplete source evidence", async () => {
    const facts = baseFacts();
    facts.dependencies.declared["@module-federation/enhanced"] = "2.8.0";
    facts.dependencies.declared["@module-federation/observability-plugin"] = "2.8.0";
    facts.imports.sourceReadFailures = ["src/runtime.ts"];

    expect(await run("config/observability-plugin-recommended", facts)).toHaveLength(0);
  });
});
