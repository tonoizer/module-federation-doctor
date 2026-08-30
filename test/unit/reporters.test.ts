import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeHealthScore } from "../../src/health-score.js";
import { CI_PROVIDER_ENV_KEYS } from "../../src/config.js";
import {
  formatTerminalReport,
  writeFederationReports,
  writeFileAtomic,
  writeReports,
} from "../../src/reporters.js";
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

function demoFacts(name = "demo"): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name, root: "." },
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
  };
}

describe("reporters", () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("writes json and sarif reports", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-"));
    roots.push(output);
    const facts = demoFacts();
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
    const project = JSON.parse(await fs.readFile(path.join(output, "project.json"), "utf8"));
    expect(json.findings[0].ruleId).toBe("config/name-required");
    expect(json.findings[0].suppressed).toBe(true);
    expect(sarif.runs[0].results[0].ruleId).toBe("config/name-required");
    expect(project.analysis).toBeUndefined();
    expect(sarif.runs[0].results[0].suppressions).toEqual([
      { kind: "external", justification: "legacy debt" },
    ]);
    await expect(fs.access(path.join(output, "report.html"))).rejects.toThrow();
    // Atomic replace leaves only final paths — no leftover temp files.
    expect((await fs.readdir(output)).sort()).toEqual(
      ["project.json", "report.json", "results.sarif"].sort(),
    );
  });

  it("replaces report files atomically and leaves no temp files", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-atomic-"));
    roots.push(output);
    const reportPath = path.join(output, "report.json");
    await fs.writeFile(reportPath, '{"stale":true}\n');

    const rename = vi.spyOn(fs, "rename");
    await writeFileAtomic(reportPath, '{"fresh":true}\n');

    expect(rename).toHaveBeenCalledOnce();
    const [from, to] = rename.mock.calls[0]!;
    expect(path.dirname(String(from))).toBe(output);
    expect(path.basename(String(from))).toMatch(/^\.report\.json\.mfdoctor-\d+-.+\.tmp$/);
    expect(String(to)).toBe(path.resolve(reportPath));
    expect(await fs.readFile(reportPath, "utf8")).toBe('{"fresh":true}\n');
    expect(await fs.readdir(output)).toEqual(["report.json"]);
  });

  it("preserves the previous report and cleans the temp file when rename fails", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-atomic-fail-"));
    roots.push(output);
    const reportPath = path.join(output, "report.json");
    await fs.writeFile(reportPath, '{"previous":true}\n');
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename blocked"));

    await expect(writeFileAtomic(reportPath, '{"next":true}\n')).rejects.toThrow(
      "Unable to atomically write report file",
    );
    expect(await fs.readFile(reportPath, "utf8")).toBe('{"previous":true}\n');
    expect(await fs.readdir(output)).toEqual(["report.json"]);
  });

  it("writes federation json and sarif via atomic replace", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-federation-"));
    roots.push(output);
    const report = emptyReport([
      {
        schemaVersion: 1,
        ruleId: "federation/name-conflict",
        severity: "error",
        message: "duplicate name",
        project: "workspace",
        evidence: {},
        fingerprint: "fed",
      },
    ]);
    const rename = vi.spyOn(fs, "rename");

    await writeFederationReports(report, output, ["json", "sarif"]);

    expect(rename.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      JSON.parse(await fs.readFile(path.join(output, "report.json"), "utf8")).findings[0].ruleId,
    ).toBe("federation/name-conflict");
    expect(
      JSON.parse(await fs.readFile(path.join(output, "results.sarif"), "utf8")).runs[0].results[0]
        .ruleId,
    ).toBe("federation/name-conflict");
    expect((await fs.readdir(output)).sort()).toEqual(["report.json", "results.sarif"].sort());
  });

  it("persists source-analysis completeness while omitting in-memory config", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-analysis-"));
    roots.push(output);
    const facts = {
      schemaVersion: 1,
      project: { name: "budgeted", root: "." },
      bundler: { name: "vite", mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
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
      analysis: {
        status: "partial" as const,
        limits: {
          maxFiles: 1,
          maxSourceBytes: 2,
          maxArtifacts: 3,
          maxEvidenceNodes: 4,
          maxSerializedBytes: 5,
          maxWallTimeMs: 6,
        },
        usage: { files: 1, sourceBytes: 2, artifacts: 0, evidenceNodes: 0, serializedBytes: 0 },
        exceeded: [{ kind: "files" as const, limit: 1 }],
      },
    } satisfies ProjectFacts;

    await writeReports(facts, emptyReport(), output, []);

    const project = JSON.parse(await fs.readFile(path.join(output, "project.json"), "utf8"));
    expect(project.analysis.status).toBe("partial");
    expect(project.analysis.exceeded).toEqual([{ kind: "files", limit: 1 }]);
  });

  it("keeps complete analysis out of legacy project facts for stable evidence baselines", async () => {
    const output = await fs.mkdtemp(
      path.join(os.tmpdir(), "mfdoctor-reporters-complete-analysis-"),
    );
    roots.push(output);
    const facts = {
      schemaVersion: 1,
      project: { name: "complete", root: "." },
      bundler: { name: "vite", mode: "ci" },
      capabilities: {
        config: true,
        sourceImports: true,
        manifest: false,
        stats: false,
        emittedAssets: false,
        installedVersions: true,
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
      analysis: {
        status: "complete" as const,
        limits: {
          maxFiles: 1,
          maxSourceBytes: 2,
          maxArtifacts: 3,
          maxEvidenceNodes: 4,
          maxSerializedBytes: 5,
          maxWallTimeMs: 6,
        },
        usage: { files: 0, sourceBytes: 0, artifacts: 0, evidenceNodes: 0, serializedBytes: 0 },
        exceeded: [],
      },
    } satisfies ProjectFacts;

    await writeReports(facts, emptyReport(), output, []);

    const project = JSON.parse(await fs.readFile(path.join(output, "project.json"), "utf8"));
    expect(project.analysis).toBeUndefined();
  });

  it("stays quiet on success by default", () => {
    expect(formatTerminalReport(emptyReport())).toBe("");
  });

  it("prints the legacy success line when printLog.success is true", () => {
    expect(formatTerminalReport(emptyReport(), { printLog: { success: true } })).toContain(
      "MFDoctor: no findings.",
    );
  });

  it("honors MFDOCTOR_QUIET=0 to restore the success line", () => {
    vi.stubEnv("MFDOCTOR_QUIET", "0");
    expect(formatTerminalReport(emptyReport())).toContain("MFDoctor: no findings.");
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
    expect(text).toContain("MFDoctor");
    expect(text).toContain("error");
    expect(text).toContain("config/expose-key-invalid");
    expect(text).toContain('Expose key "Widget" must start with "./".');
    expect(text).toContain('fix: Rename the key to "./Widget".');
    expect(text).toContain("docs: https://mfdoctor.kevinbeier.com/rules/config/expose-key-invalid");
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
    expect(text).toContain("MFDoctor: no findings.");
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
    const withPrompts = formatTerminalReport(report, { prompt: true });
    expect(withPrompts).toContain("Score: 99/100 (Great)");
    expect(withPrompts).toContain("Agent prompts (top 1)");
    expect(withPrompts).toContain("# Fix: config/expose-key-invalid");

    const without = formatTerminalReport(report, { prompt: false });
    expect(without).toContain("Score: 99/100 (Great)");
    expect(without).not.toContain("Agent prompts");
  });

  it("hides agent prompts by default in CI and shows them locally", () => {
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

    vi.stubEnv("CI", "");
    for (const key of CI_PROVIDER_ENV_KEYS) vi.stubEnv(key, "");
    expect(formatTerminalReport(report)).toContain("Agent prompts (top 1)");

    vi.stubEnv("CI", "true");
    expect(formatTerminalReport(report)).not.toContain("Agent prompts");
    expect(formatTerminalReport(report, { prompt: true })).toContain("Agent prompts (top 1)");
  });

  it("emits JSON on stdout for --output - without writing report.json", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-stdout-"));
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
        fingerprint: "abc",
        documentation: "/rules/config/name-required",
      },
    ]);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutWrite = process.stdout.write;
    const stderrWrite = process.stderr.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      await writeReports(facts, report, output, ["terminal", "json"], { stdoutJson: true });
    } finally {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    }
    const payload = JSON.parse(stdout.join("")) as DoctorReport;
    expect(payload.findings[0]?.ruleId).toBe("config/name-required");
    expect(stdout.join("")).not.toContain("Agent prompts");
    expect(stderr.join("")).toContain("config/name-required");
    expect(stderr.join("")).not.toContain("Agent prompts");
    await expect(fs.access(path.join(output, "project.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(output, "report.json"))).rejects.toThrow();
  });

  it("skips all report files with write: false and still emits JSON on stdout", async () => {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-reporters-nowrite-"));
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
    const report = emptyReport();
    const stdout: string[] = [];
    const stdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await writeReports(facts, report, output, ["json", "sarif"], { write: false });
    } finally {
      process.stdout.write = stdoutWrite;
    }
    expect(JSON.parse(stdout.join(""))).toMatchObject({ schemaVersion: 1, findings: [] });
    await expect(fs.readdir(output)).resolves.toEqual([]);
  });
});
