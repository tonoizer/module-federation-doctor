import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { analyze } from "../../src/engine.js";
import { builtInRules } from "../../src/rules.js";
import type { BundlerName, DoctorFinding, ProjectFacts } from "../../src/types.js";

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/shared-subpath-version",
);
const roots: string[] = [];
const enhancedBundlers = ["webpack", "rspack"] as const satisfies readonly BundlerName[];

const quietRules = {
  "doctor/partial-analysis": "off",
  "config/plugin-package-mismatch": "off",
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "artifact/types-metadata-missing": "off",
  "shared/unused": "off",
  "shared/candidate": "off",
} as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempProject(bundler: BundlerName): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-prefix-share-${bundler}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: `prefix-share-${bundler}`,
      dependencies: { "@module-federation/enhanced": "2.8.2" },
    }),
  );
  await fs.writeFile(
    path.join(root, "src/Widget.ts"),
    'import { jsx } from "react/jsx-runtime";\nexport const Widget = () => jsx("div", {});\n',
  );
  return root;
}

async function copyFixture(name: "enhanced-rspack" | "enhanced-webpack") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-${name}-`));
  roots.push(root);
  await fs.cp(path.join(fixtures, name), root, { recursive: true });
  return root;
}

async function checkFixture(root: string) {
  const exitCode = await main(["check", root, "--ci", "--format", "json"]);
  const reportPath = path.join(root, ".mf/doctor/report.json");
  const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as {
    findings: Array<{ ruleId: string; evidence?: Record<string, unknown> }>;
  };
  return { exitCode, report };
}

function ruleIds(findings: Array<{ ruleId: string }>): string[] {
  return findings.map((item) => item.ruleId);
}

describe("prefix shares on webpack/rspack Enhanced", () => {
  it("keeps prefix-share all-bundler and subpath-version Vite-only after BL-01", () => {
    expect(
      builtInRules.find((item) => item.meta.id === "shared/prefix-share-recommended")?.meta
        .supportedBundlers,
    ).toEqual(["vite", "rspack", "rsbuild", "webpack", "modern"]);
    expect(
      builtInRules.find((item) => item.meta.id === "shared/subpath-version-unresolved")?.meta
        .supportedBundlers,
    ).toEqual(["vite"]);
  });

  it.each(enhancedBundlers)(
    "fires prefix-share-recommended for uncovered react deep imports on %s",
    async (bundler) => {
      const root = await tempProject(bundler);
      const result = await analyze({
        root,
        bundler,
        mode: "ci",
        output: { formats: [] },
        moduleFederation: {
          name: "host",
          exposes: { "./Widget": "./src/Widget.ts" },
          shared: { react: { singleton: true } },
        },
        rules: quietRules,
      });

      expect(result.facts.bundler.name).toBe(bundler);
      expect(result.facts.imports.deepImports).toContain("react/jsx-runtime");
      expect(result.report.findings).toContainEqual(
        expect.objectContaining({
          ruleId: "shared/prefix-share-recommended",
          severity: "error",
          evidence: expect.objectContaining({
            package: "react",
            specifiers: expect.arrayContaining(["react/jsx-runtime"]),
          }),
        }),
      );
      expect(ruleIds(result.report.findings)).not.toContain("shared/subpath-version-unresolved");
      expect(result.exitCode).toBe(1);
    },
  );

  it.each(enhancedBundlers)(
    "does not inherit Vite parent versions for prefix/subpath shares on %s",
    async (bundler) => {
      const root = await tempProject(bundler);
      const result = await analyze({
        root,
        bundler,
        mode: "ci",
        output: { formats: [] },
        moduleFederation: {
          name: "host",
          exposes: { "./Widget": "./src/Widget.ts" },
          shared: {
            react: { singleton: true },
            "react/": { singleton: true },
            "lodash/": { singleton: true },
            "@acme/ui/button": { singleton: true },
          },
        },
        rules: quietRules,
      });

      expect(result.facts.bundler.name).toBe(bundler);
      expect(ruleIds(result.report.findings)).not.toContain("shared/subpath-version-unresolved");
      expect(ruleIds(result.report.findings)).not.toContain("shared/prefix-share-recommended");
    },
  );

  it("still fires unresolved-version on Vite for the same prefix/subpath shape", async () => {
    const findings: DoctorFinding[] = [];
    const rule = builtInRules.find((item) => item.meta.id === "shared/subpath-version-unresolved")!;
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
        name: "fixture",
        exposes: {},
        remotes: {},
        shared: {
          "react/": {
            package: "react/",
            singleton: true,
            eager: false,
            shareScope: ["default"],
          },
          "lodash/": {
            package: "lodash/",
            singleton: true,
            eager: false,
            shareScope: ["default"],
          },
          "@acme/ui/button": {
            package: "@acme/ui/button",
            singleton: true,
            eager: false,
            shareScope: ["default"],
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
    };
    await rule.check({
      facts,
      options: {},
      report: (finding) => findings.push(finding as DoctorFinding),
    });
    expect(findings.map((item) => item.evidence?.package).sort()).toEqual([
      "@acme/ui/button",
      "lodash/",
      "react/",
    ]);
  });

  it.each(["enhanced-rspack", "enhanced-webpack"] as const)(
    "proves %s through mfdoctor check",
    async (name) => {
      const root = await copyFixture(name);
      const { exitCode, report } = await checkFixture(root);
      const prefix = report.findings.filter(
        (item) => item.ruleId === "shared/prefix-share-recommended",
      );
      expect(prefix).toEqual([
        expect.objectContaining({
          ruleId: "shared/prefix-share-recommended",
          evidence: expect.objectContaining({
            package: "react",
            specifiers: expect.arrayContaining(["react/jsx-runtime"]),
          }),
        }),
      ]);
      expect(
        report.findings.filter((item) => item.ruleId === "shared/subpath-version-unresolved"),
      ).toHaveLength(0);
      expect(exitCode).toBe(1);
    },
  );
});
