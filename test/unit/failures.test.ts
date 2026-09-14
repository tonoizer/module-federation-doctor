import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze, analyzeFederation } from "../../src/engine.js";
import { defineRule } from "../../src/rules.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function throwingRule() {
  return defineRule({
    meta: {
      id: "test/throws-structured",
      defaultSeverity: "error",
      supportedBundlers: ["unknown"],
      documentation: "/rules/test/throws-structured",
    },
    check(context) {
      context.report({ message: "finding before throw", evidence: { source: "before-throw" } });
      throw new Error("rule exploded");
    },
  });
}

function baseOptions(root: string) {
  return {
    root,
    mode: "ci" as const,
    failOn: "never" as const,
    output: { formats: [], write: false },
    rules: { "doctor/partial-analysis": "off" as const },
  };
}

describe("strict completeness and failure artifacts", () => {
  it("keeps legacy exit semantics unless completeness is explicitly required", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-strict-legacy-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"strict-legacy"}');

    const legacy = await analyze(baseOptions(root));
    const strict = await analyze({ ...baseOptions(root), requireComplete: true });

    expect(legacy.report.status).toMatchObject({ complete: false });
    expect(legacy.report.status?.incompleteReasons).toContain("missing-emit");
    expect(legacy.exitCode).toBe(0);
    expect(strict.exitCode).toBe(1);
    expect(strict.report.status).toEqual(legacy.report.status);
  });

  it("structures thrown rule failures and preserves findings reported before the throw", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-structured-rule-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"structured-rule"}');

    const result = await analyze({ ...baseOptions(root), extends: [throwingRule()] });
    const beforeThrow = result.report.findings.find(
      (item) => item.evidence.source === "before-throw",
    );
    const failure = result.report.findings.find((item) => item.ruleId === "test/throws-structured");

    expect(beforeThrow).toBeDefined();
    expect(failure).toMatchObject({
      ruleId: "test/throws-structured",
      detailsSchema: "doctor.run-failure.v1",
      details: {
        phase: "rule",
        errorCode: "rule-execution-failed",
        error: "rule exploded",
        ruleId: "test/throws-structured",
      },
      evidence: {
        phase: "rule",
        errorCode: "rule-execution-failed",
        ruleId: "test/throws-structured",
      },
    });
    expect(failure?.details?.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(failure?.fingerprint).toBeDefined();
  });

  it("replaces a stale report with a structured current-run failure artifact", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-stale-report-"));
    roots.push(root);
    const output = path.join(root, "reports");
    const reportPath = path.join(output, "report.json");
    const sarifPath = path.join(output, "results.sarif");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(reportPath, '{"stale":true}\n');
    await fs.writeFile(sarifPath, '{"staleSarif":true}\n');
    await fs.writeFile(path.join(root, "package.json"), '{"name":"stale-report"}');

    const result = await analyze({
      ...baseOptions(root),
      output: { formats: ["json", "sarif"], directory: output },
      baseline: path.join(root, "missing-baseline.json"),
      requireComplete: true,
    });
    const current = JSON.parse(await fs.readFile(reportPath, "utf8")) as typeof result.report;

    expect(result.exitCode).toBe(1);
    expect(current).toMatchObject({ schemaVersion: 1, status: { complete: false } });
    expect(current.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "doctor/analysis-failed",
        detailsSchema: "doctor.run-failure.v1",
        details: expect.objectContaining({ phase: "analysis", errorCode: "analysis-failed" }),
      }),
    );
    expect(current.status?.incompleteReasons).toEqual([
      "missing-emit",
      "partial-bundler",
      "evidence-unknown",
    ]);
    expect(current).not.toHaveProperty("stale");
    const currentSarif = JSON.parse(await fs.readFile(sarifPath, "utf8")) as {
      runs: Array<{ results: Array<{ ruleId: string }> }>;
    };
    expect(currentSarif.runs[0]?.results).toContainEqual(
      expect.objectContaining({ ruleId: "doctor/analysis-failed" }),
    );
    expect((await fs.readdir(output)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("replaces a stale workspace report when federation analysis fails outside the rule loop", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-stale-workspace-"));
    roots.push(root);
    const output = path.join(root, "reports");
    const reportPath = path.join(output, "report.json");
    const sarifPath = path.join(output, "results.sarif");
    const projectPath = path.join(root, "project.json");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(reportPath, '{"stale":true}\n');
    await fs.writeFile(sarifPath, '{"staleSarif":true}\n');
    await fs.writeFile(
      projectPath,
      JSON.stringify({
        schemaVersion: 1,
        project: { name: "workspace-fixture", root: "." },
        bundler: { name: "vite", mode: "ci" },
        capabilities: {
          config: true,
          sourceImports: false,
          manifest: false,
          stats: false,
          emittedAssets: false,
          installedVersions: false,
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
      }),
    );

    const result = await analyzeFederation([projectPath], {
      root,
      outputDirectory: output,
      formats: ["json"],
      baseline: path.join(root, "missing-baseline.json"),
      requireComplete: true,
    });
    const current = JSON.parse(await fs.readFile(reportPath, "utf8")) as typeof result.report;

    expect(result.exitCode).toBe(1);
    expect(current).not.toHaveProperty("stale");
    expect(current).toMatchObject({
      summary: { projects: 0 },
      status: { complete: false },
    });
    expect(current.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "doctor/analysis-failed",
        detailsSchema: "doctor.run-failure.v1",
      }),
    );
    await expect(fs.access(sarifPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("normalizes relative federation output for success and failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-relative-federation-"));
    roots.push(root);
    const projectPath = path.join(root, "project.json");
    const fixturePath = path.resolve(
      import.meta.dirname,
      "../../fixtures/workspaces/clean/host/.mf/doctor/project.json",
    );
    const facts = JSON.parse(await fs.readFile(fixturePath, "utf8")) as {
      capabilities: { emittedAssets: boolean };
      artifacts: { emittedAssets: string[] };
    };
    facts.capabilities.emittedAssets = true;
    facts.artifacts.emittedAssets = ["remoteEntry.js"];
    await fs.writeFile(projectPath, JSON.stringify(facts));

    const previous = process.cwd();
    try {
      expect(path.resolve(root)).not.toBe(previous);
      const success = await analyzeFederation([projectPath], {
        root,
        outputDirectory: ".mf/doctor",
        formats: ["json"],
        requireComplete: true,
      });
      expect(success.exitCode).toBe(0);
      const reportPath = path.join(root, ".mf/doctor/report.json");
      await expect(fs.access(reportPath)).resolves.toBeUndefined();

      const failure = await analyzeFederation([projectPath], {
        root,
        outputDirectory: ".mf/doctor",
        formats: ["json"],
        baseline: path.join(root, "missing-baseline.json"),
        requireComplete: true,
      });
      expect(failure.exitCode).toBe(1);
      expect(JSON.parse(await fs.readFile(reportPath, "utf8"))).toMatchObject({
        findings: [expect.objectContaining({ ruleId: "doctor/analysis-failed" })],
      });
    } finally {
      process.chdir(previous);
    }
  });
});
