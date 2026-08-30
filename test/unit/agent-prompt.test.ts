import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentPrompt,
  DEFAULT_PROMPT_FINDINGS,
  DIAGNOSTICS_PROMPTS_ENV,
  findPromptTarget,
  formatTopAgentPrompts,
  MAX_DIAGNOSTICS_PROMPT_FINDINGS,
  resolveDiagnosticsDir,
  resolveDiagnosticsPromptLimit,
  resolveDiagnosticsPromptLimitFromEnv,
  selectTopFindings,
  writeDiagnosticsDump,
} from "../../src/agent-prompt.js";
import type { DoctorFinding, DoctorReport } from "../../src/types.js";

function finding(
  partial: Pick<DoctorFinding, "ruleId" | "severity" | "fingerprint"> &
    Partial<Omit<DoctorFinding, "ruleId" | "severity" | "fingerprint">>,
): DoctorFinding {
  return {
    schemaVersion: 1,
    message: partial.message ?? `${partial.ruleId} message`,
    project: partial.project ?? "demo",
    evidence: partial.evidence ?? { package: "react" },
    ...partial,
  };
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("agent prompts", () => {
  it("builds a stable single-finding prompt contract", () => {
    const prompt = buildAgentPrompt(
      finding({
        ruleId: "config/name-required",
        severity: "error",
        fingerprint: "fp-name",
        message: "Container name is required.",
        suggestion: 'Set name to "host".',
        location: { path: "module-federation.config.ts", line: 3, column: 1 },
        documentation: "/rules/config/name-required",
        evidence: { missing: true, note: "x".repeat(200) },
      }),
    );
    expect(prompt).toContain("# Fix: config/name-required");
    expect(prompt).toContain("Fix exactly this MFDoctor finding");
    expect(prompt).toContain("Do not suggest suppressions");
    expect(prompt).toContain("- Fingerprint: `fp-name`");
    expect(prompt).toContain("- Location: `module-federation.config.ts:3:1`");
    expect(prompt).toContain('Set name to "host".');
    expect(prompt).toContain("mfdoctor check");
    expect(prompt).toContain(
      "- MFDoctor: https://mfdoctor.kevinbeier.com/rules/config/name-required",
    );
    // Evidence values are bounded
    expect(prompt).toMatch(/note: x{120}…/);
  });

  it("stringifies undefined evidence values without throwing", () => {
    const prompt = buildAgentPrompt(
      finding({
        ruleId: "config/remote-alias-prefix-collision",
        severity: "error",
        fingerprint: "fp-undef",
        evidence: { alias: "@scope", collidingWith: undefined as unknown as string },
      }),
    );
    expect(prompt).toContain("- collidingWith: undefined");
  });

  it("orders top-3 by severity then impact and skips suppressed", () => {
    const findings = [
      finding({
        ruleId: "shared/candidate",
        severity: "info",
        fingerprint: "z-info",
      }),
      finding({
        ruleId: "config/name-required",
        severity: "error",
        fingerprint: "a-error",
      }),
      finding({
        ruleId: "shared/singleton-mismatch",
        severity: "warning",
        fingerprint: "b-warn",
      }),
      finding({
        ruleId: "config/expose-key-invalid",
        severity: "error",
        fingerprint: "c-error",
        suppressed: true,
      }),
      finding({
        ruleId: "config/remote-http-insecure",
        severity: "error",
        fingerprint: "d-error",
      }),
    ];
    const top = selectTopFindings(findings, 3);
    expect(top.map((item) => item.fingerprint)).toEqual(["a-error", "d-error", "b-warn"]);
    const text = formatTopAgentPrompts(findings);
    expect(text).toContain("Agent prompts (top 3)");
    expect(text).toContain("# Fix: config/name-required");
    expect(text).not.toContain("config/expose-key-invalid");
  });

  it("resolves --finding by fingerprint or ruleId", () => {
    const findings = [
      finding({
        ruleId: "config/name-required",
        severity: "error",
        fingerprint: "fp-1",
      }),
      finding({
        ruleId: "shared/candidate",
        severity: "info",
        fingerprint: "fp-2",
      }),
    ];
    expect(findPromptTarget(findings, "fp-2")?.ruleId).toBe("shared/candidate");
    expect(findPromptTarget(findings, "config/name-required")?.fingerprint).toBe("fp-1");
    expect(findPromptTarget(findings, "missing")).toBeUndefined();
  });

  it("clears stale prompt files and allows ..-prefixed in-root names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-diag-"));
    roots.push(root);
    expect(resolveDiagnosticsDir(root, "..hidden")).toBe(path.resolve(root, "..hidden"));

    const dumpRoot = resolveDiagnosticsDir(root, "diag");
    const report: DoctorReport = {
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
        info: 0,
        warnings: 0,
        errors: 1,
        score: 99,
        scoreLabel: "Great",
      },
      findings: [
        finding({
          ruleId: "config/name-required",
          severity: "error",
          fingerprint: "old-fp",
          message: "old",
        }),
      ],
    };
    await writeDiagnosticsDump(report, dumpRoot);
    const first = await fs.readdir(path.join(dumpRoot, "prompts"));
    expect(first).toHaveLength(1);

    const next: DoctorReport = {
      ...report,
      findings: [
        finding({
          ruleId: "config/expose-key-invalid",
          severity: "error",
          fingerprint: "new-fp",
          message: "new",
        }),
      ],
    };
    await writeDiagnosticsDump(next, dumpRoot);
    const second = await fs.readdir(path.join(dumpRoot, "prompts"));
    expect(second).toHaveLength(1);
    expect(second[0]).toContain("expose-key-invalid");
  });

  it("keeps diagnostics-dir root-contained and writes dump layout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-diag-"));
    roots.push(root);
    expect(() => resolveDiagnosticsDir(root, "../escape")).toThrow(/inside the project root/);

    const dumpRoot = resolveDiagnosticsDir(root, ".mf/doctor/diagnostics");
    const report: DoctorReport = {
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
        info: 0,
        warnings: 0,
        errors: 1,
        score: 99,
        scoreLabel: "Great",
      },
      findings: [
        finding({
          ruleId: "config/name-required",
          severity: "error",
          fingerprint: "fp-dump",
          message: "name required",
        }),
      ],
    };
    const result = await writeDiagnosticsDump(report, dumpRoot);
    await expect(fs.access(result.reportPath)).resolves.toBeUndefined();
    await expect(fs.access(result.summaryPath)).resolves.toBeUndefined();
    expect(result.promptFiles).toHaveLength(1);
    const prompt = await fs.readFile(path.join(dumpRoot, result.promptFiles[0]!), "utf8");
    expect(prompt).toContain("# Fix: config/name-required");
    const summary = await fs.readFile(result.summaryPath, "utf8");
    expect(summary).toContain("Score: 99/100 (Great)");
    expect(summary).toContain("config/name-required");
  });

  it("defaults diagnostics dumps to top-3 and allows opt-in beyond with a hard cap", async () => {
    expect(DEFAULT_PROMPT_FINDINGS).toBe(3);
    expect(MAX_DIAGNOSTICS_PROMPT_FINDINGS).toBe(25);
    expect(resolveDiagnosticsPromptLimit()).toBe(3);
    expect(resolveDiagnosticsPromptLimit(10)).toBe(10);
    expect(resolveDiagnosticsPromptLimit("7")).toBe(7);
    expect(() => resolveDiagnosticsPromptLimit(0)).toThrow(/integer between 1 and 25/);
    expect(() => resolveDiagnosticsPromptLimit(1.5)).toThrow(/integer between 1 and 25/);
    expect(() => resolveDiagnosticsPromptLimit(26)).toThrow(/dump budget of 25/);
    expect(resolveDiagnosticsPromptLimitFromEnv(undefined, {})).toBe(3);
    expect(
      resolveDiagnosticsPromptLimitFromEnv(undefined, { [DIAGNOSTICS_PROMPTS_ENV]: "12" }),
    ).toBe(12);
    expect(resolveDiagnosticsPromptLimitFromEnv(4, { [DIAGNOSTICS_PROMPTS_ENV]: "12" })).toBe(4);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-diag-limit-"));
    roots.push(root);
    const dumpRoot = resolveDiagnosticsDir(root, "diag");
    const findings = Array.from({ length: 8 }, (_, index) =>
      finding({
        ruleId: "config/name-required",
        severity: "error",
        fingerprint: `fp-${String(index).padStart(2, "0")}`,
        message: `finding ${index}`,
      }),
    );
    const report: DoctorReport = {
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
        info: 0,
        warnings: 0,
        errors: 8,
        score: 40,
        scoreLabel: "Needs work",
      },
      findings,
    };

    const defaultDump = await writeDiagnosticsDump(report, dumpRoot);
    expect(defaultDump.promptFiles).toHaveLength(3);
    expect(await fs.readdir(path.join(dumpRoot, "prompts"))).toHaveLength(3);

    const wider = await writeDiagnosticsDump(report, dumpRoot, { limit: 6 });
    expect(wider.promptFiles).toHaveLength(6);
    const summary = await fs.readFile(wider.summaryPath, "utf8");
    expect(summary).toContain("Top findings (6 of 8, dump budget 6)");
    expect(formatTopAgentPrompts(findings)).toContain("Agent prompts (top 3)");
    expect(formatTopAgentPrompts(findings)).not.toContain("finding 5");
  });
});
