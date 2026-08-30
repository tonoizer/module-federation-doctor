import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { builtInRules } from "../../src/rules.js";
import type { DoctorFinding, ProjectFacts } from "../../src/types.js";

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/shared-subpath-version",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function runRule(facts: ProjectFacts) {
  const findings: DoctorFinding[] = [];
  const rule = builtInRules.find((item) => item.meta.id === "shared/subpath-version-unresolved")!;
  await rule.check({
    facts,
    options: {},
    report: (finding) => findings.push(finding as DoctorFinding),
  });
  return findings;
}

function baseFacts(overrides: Partial<ProjectFacts> = {}): ProjectFacts {
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
    ...overrides,
  };
}

async function copyFixture(name: "unresolved" | "resolved") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-subpath-version-${name}-`));
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

describe("shared/subpath-version-unresolved", () => {
  it("fires when a Vite prefix/subpath share cannot inherit a parent version", async () => {
    const facts = baseFacts({
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
          "@acme/ui/button": {
            package: "@acme/ui/button",
            singleton: true,
            eager: false,
            shareScope: ["default"],
          },
        },
      },
      dependencies: { declared: {}, installed: {} },
    });

    const findings = await runRule(facts);
    expect(findings.map((item) => item.evidence?.package).sort()).toEqual([
      "@acme/ui/button",
      "react/",
    ]);
    expect(findings[0]?.message).toContain("no resolvable version");
  });

  it("stays quiet when the parent package version resolves", async () => {
    const facts = baseFacts({
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
          "react/jsx-runtime": {
            package: "react/jsx-runtime",
            singleton: true,
            eager: false,
            shareScope: ["default"],
          },
        },
      },
      dependencies: { declared: { react: "19.1.1" }, installed: { react: "19.1.1" } },
    });

    expect(await runRule(facts)).toHaveLength(0);
  });

  it("stays quiet with an explicit version or concrete requiredVersion", async () => {
    const facts = baseFacts({
      moduleFederation: {
        name: "fixture",
        exposes: {},
        remotes: {},
        shared: {
          "lodash/cloneDeep": {
            package: "lodash/cloneDeep",
            singleton: true,
            eager: false,
            shareScope: ["default"],
            version: "4.17.21",
          },
          "@acme/ui/button": {
            package: "@acme/ui/button",
            singleton: true,
            eager: false,
            shareScope: ["default"],
            requiredVersion: "^1.2.3",
          },
        },
      },
      dependencies: { declared: {}, installed: {} },
    });

    expect(await runRule(facts)).toHaveLength(0);
  });

  it("bounds false positives for non-Vite bundlers and bare package keys", async () => {
    const shared = {
      react: {
        package: "react",
        singleton: true,
        eager: false,
        shareScope: ["default"],
      },
      "react/": {
        package: "react/",
        singleton: true,
        eager: false,
        shareScope: ["default"],
      },
    };

    expect(
      await runRule(
        baseFacts({
          bundler: { name: "rspack", mode: "ci" },
          moduleFederation: { name: "fixture", exposes: {}, remotes: {}, shared },
          dependencies: { declared: {}, installed: {} },
        }),
      ),
    ).toHaveLength(0);

    expect(
      await runRule(
        baseFacts({
          moduleFederation: {
            name: "fixture",
            exposes: {},
            remotes: {},
            shared: {
              react: {
                package: "react",
                singleton: true,
                eager: false,
                shareScope: ["default"],
              },
            },
          },
          dependencies: { declared: {}, installed: {} },
        }),
      ),
    ).toHaveLength(0);
  });

  it("skips when installedVersions collection did not complete", async () => {
    const facts = baseFacts({
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: false,
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
        },
      },
    });

    expect(await runRule(facts)).toHaveLength(0);
  });

  it("proves the unresolved fixture through mfdoctor check", async () => {
    const root = await copyFixture("unresolved");
    const { exitCode, report } = await checkFixture(root);
    const findings = report.findings.filter(
      (item) => item.ruleId === "shared/subpath-version-unresolved",
    );
    expect(findings.map((item) => item.evidence?.package).sort()).toEqual([
      "@acme/ui/button",
      "lodash/",
    ]);
    expect(exitCode).toBe(1);
  });

  it("proves the resolved fixture stays quiet through mfdoctor check", async () => {
    const root = await copyFixture("resolved");
    // Seed an installed parent so Vite can inherit `react/`'s provider version.
    await fs.mkdir(path.join(root, "node_modules/react"), { recursive: true });
    await fs.writeFile(
      path.join(root, "node_modules/react/package.json"),
      JSON.stringify({ name: "react", version: "19.1.1", main: "index.js" }),
    );
    await fs.writeFile(path.join(root, "node_modules/react/index.js"), "module.exports = {};\n");

    const { exitCode, report } = await checkFixture(root);
    expect(
      report.findings.filter((item) => item.ruleId === "shared/subpath-version-unresolved"),
    ).toHaveLength(0);
    expect(exitCode).toBe(0);
  });
});
