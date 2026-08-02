import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeHealthScore } from "../../src/health-score.js";
import { formatTerminalReport, writeReports } from "../../src/reporters.js";
import type { DoctorReport, ProjectFacts } from "../../src/types.js";

function emptyReport(findings: DoctorReport["findings"] = []): DoctorReport {
  const health = computeHealthScore(findings);
  return {
    schemaVersion: 1,
    capabilities: {
      config: true,
      sourceImports: false,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: false,
    },
    summary: {
      projects: 1,
      info: findings.filter((f) => f.severity === "info").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      errors: findings.filter((f) => f.severity === "error").length,
      suppressed: findings.filter((f) => f.suppressed).length,
      score: health.score,
      scoreLabel: health.scoreLabel,
    },
    findings,
  };
}

describe("reporters", () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("writes json and sarif reports", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-"));
    roots.push(output);
    const facts = {
      schemaVersion: 1,
      project: { name: "demo", root: "." },
      bundler: { name: "vite", mode: "development" },
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
    } satisfies ProjectFacts;
    const report = emptyReport([
      {
        schemaVersion: 1,
        ruleId: "config/name-required",
        severity: "error",
        message: "name is required",
        project: "demo",
        evidence: {},
        documentation: "/rules/config/name-required",
        fingerprint: "abc",
        suppressed: true,
        suppressionReason: "legacy debt",
      },
    ]);

    await writeReports(facts, report, output, ["json", "sarif"]);

    const json = JSON.parse(await fs.readFile(path.join(output, "report.json"), "utf8"));
    const sarif = JSON.parse(await fs.readFile(path.join(output, "results.sarif"), "utf8"));
    expect(json.findings[0].ruleId).toBe("config/name-required");
    expect(json.findings[0].suppressed).toBe(true);
    expect(sarif.runs[0].results[0].ruleId).toBe("config/name-required");
    expect(sarif.runs[0].results[0].suppressions).toEqual([
      { kind: "external", justification: "legacy debt" },
    ]);
    await expect(fs.access(path.join(output, "report.html"))).rejects.toThrow();
  });

  it("stays quiet on success by default", () => {
    expect(formatTerminalReport(emptyReport())).toBe("");
  });

  it("prints the legacy success line when printLog.success is true", () => {
    expect(formatTerminalReport(emptyReport(), { printLog: { success: true } })).toContain(
      "Module Federation Doctor: no findings.",
    );
  });

  it("honors MFDOCTOR_QUIET=0 to restore the success line", () => {
    vi.stubEnv("MFDOCTOR_QUIET", "0");
    expect(formatTerminalReport(emptyReport())).toContain("Module Federation Doctor: no findings.");
  });

  it("formats severity, ruleId, message, suggestion, and doc links", () => {
    const text = formatTerminalReport(
      emptyReport([
        {
          schemaVersion: 1,
          ruleId: "config/expose-key-invalid",
          severity: "error",
          message: 'Expose key "Widget" must start with "./".',
          project: "demo",
          evidence: {},
          suggestion: 'Rename the key to "./Widget".',
          documentation: "/rules/config/expose-key-invalid",
          fingerprint: "fp",
        },
      ]),
    );
    expect(text).toContain("Module Federation Doctor");
    expect(text).toContain("error");
    expect(text).toContain("config/expose-key-invalid");
    expect(text).toContain('Expose key "Widget" must start with "./".');
    expect(text).toContain('fix: Rename the key to "./Widget".');
    expect(text).toContain(
      "docs: https://module-federation.github.io/rules/config/expose-key-invalid",
    );
    expect(text).toContain("source: https://module-federation.io/configure/exposes.html");
    expect(text).toContain("1 error(s)");
    expect(text).toContain("Score: 99/100 (Great)");
  });

  it("omits the score footer when score: false", () => {
    const text = formatTerminalReport(
      emptyReport([
        {
          schemaVersion: 1,
          ruleId: "config/expose-key-invalid",
          severity: "error",
          message: "bad key",
          project: "demo",
          evidence: {},
          fingerprint: "fp",
        },
      ]),
      { score: false },
    );
    expect(text).toContain("1 error(s)");
    expect(text).not.toContain("Score:");
  });

  it("prints n/a when score is null (partial analysis)", () => {
    const report = emptyReport([
      {
        schemaVersion: 1,
        ruleId: "doctor/partial-analysis",
        severity: "warning",
        message: "partial",
        project: "demo",
        evidence: {},
        fingerprint: "fp",
      },
    ]);
    expect(report.summary.score).toBeNull();
    const text = formatTerminalReport(report);
    expect(text).toContain("Score: n/a (partial analysis)");
  });

  it("includes score on verbose success", () => {
    const text = formatTerminalReport(emptyReport(), { printLog: { success: true } });
    expect(text).toContain("Module Federation Doctor: no findings.");
    expect(text).toContain("Score: 100/100 (Great)");
  });

  it("prints top agent prompts after the score and honors prompt: false", () => {
    const report = emptyReport([
      {
        schemaVersion: 1,
        ruleId: "config/expose-key-invalid",
        severity: "error",
        message: "bad key",
        project: "demo",
        evidence: {},
        fingerprint: "fp",
        documentation: "/rules/config/expose-key-invalid",
      },
    ]);
    const withPrompts = formatTerminalReport(report);
    expect(withPrompts).toContain("Score: 99/100 (Great)");
    expect(withPrompts).toContain("Agent prompts (top 1)");
    expect(withPrompts).toContain("# Fix: config/expose-key-invalid");

    const without = formatTerminalReport(report, { prompt: false });
    expect(without).toContain("Score: 99/100 (Great)");
    expect(without).not.toContain("Agent prompts");
  });
});
