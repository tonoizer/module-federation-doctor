import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AnalysisBudgetTracker, resolveAnalysisBudgets } from "../../src/analysis-budgets.js";
import { analyze } from "../../src/engine.js";
import { defineRule } from "../../src/rules.js";

describe("diagnostic edge cases", () => {
  it("reports malformed artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-malformed-"));
    try {
      await fs.mkdir(path.join(root, "dist"));
      await fs.writeFile(path.join(root, "package.json"), '{"name":"malformed"}');
      await fs.copyFile(
        path.resolve("fixtures/manifests/malformed.json"),
        path.join(root, "dist/mf-manifest.json"),
      );
      const result = await analyze({
        root,
        mode: "ci",
        output: { formats: [] },
        rules: { "doctor/partial-analysis": "off" },
      });
      expect(result.exitCode).toBe(1);
      expect(result.report.findings[0]?.ruleId).toBe("artifact/manifest-invalid");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("runs async custom rules against frozen facts and redacts evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-custom-"));
    try {
      await fs.writeFile(path.join(root, "package.json"), '{"name":"custom"}');
      const custom = defineRule({
        meta: {
          id: "team/custom",
          defaultSeverity: "warning",
          supportedBundlers: ["unknown"],
          documentation: "/rules/team/custom",
        },
        async check(context) {
          await Promise.resolve();
          expect(Object.isFrozen(context.facts)).toBe(true);
          context.report({
            message: `Found ${root}`,
            evidence: { token: "secret", path: path.join(root, "x") },
          });
        },
      });
      const result = await analyze({
        root,
        output: { formats: [] },
        extends: [custom],
        rules: { "doctor/partial-analysis": "off" },
      });
      expect(result.report.findings[0]).toMatchObject({
        ruleId: "team/custom",
        message: "Found .",
        evidence: { token: "[REDACTED]", path: `.${path.sep}x` },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns exit 2 when analysis cannot read a requested source", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-failure-"));
    try {
      await fs.writeFile(path.join(root, "package.json"), '{"name":"failure"}');
      await fs.mkdir(path.join(root, "src"));
      const badFile = path.join(root, "src/bad.ts");
      await fs.writeFile(badFile, "x");
      const originalReadFile = fs.readFile;
      const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
        if (path.resolve(String(file)) === badFile) {
          const error = new Error("fixture read failed");
          (error as NodeJS.ErrnoException).code = "EACCES";
          throw error;
        }
        return originalReadFile(file, options);
      });
      try {
        const result = await analyze({
          root,
          include: ["src/bad.ts"],
          output: { formats: [] },
        });
        expect(result.exitCode).toBe(2);
        expect(result.facts.analysis?.status).toBe("unknown");
        expect(result.facts.imports.unresolvedDynamic).toEqual([]);
        expect(result.facts.imports.sourceReadFailures).toEqual(["src/bad.ts"]);
        const finding = result.report.findings.find(
          (item) => item.ruleId === "doctor/partial-analysis",
        );
        expect(finding?.message).toMatch(/unreadable|unknown source input/i);
        expect(finding?.suggestion).toMatch(/unreadable|unknown source input/i);
        expect(finding?.message).not.toMatch(/dynamic import/i);
        expect(finding?.suggestion).not.toMatch(/dynamic import/i);
      } finally {
        readFileSpy.mockRestore();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each(["partial", "unknown"] as const)(
    "returns exit 2 and typed partial details for %s status without exceeded limits",
    async (status) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-status-${status}-`));
      const report = {
        status,
        limits: resolveAnalysisBudgets(),
        usage: { files: 1, sourceBytes: 1, artifacts: 0, evidenceNodes: 0, serializedBytes: 0 },
        exceeded: [],
      };
      const reportSpy = vi.spyOn(AnalysisBudgetTracker.prototype, "report").mockReturnValue(report);
      try {
        await fs.writeFile(path.join(root, "package.json"), '{"name":"status-fixture"}');
        await fs.mkdir(path.join(root, "src"));
        await fs.writeFile(path.join(root, "src/index.ts"), 'import "react";\n');

        const result = await analyze({
          root,
          include: ["src/index.ts"],
          output: { formats: [] },
        });

        expect(result.facts.analysis?.status).toBe(status);
        expect(result.facts.analysis?.exceeded).toEqual([]);
        expect(result.exitCode).toBe(2);
        expect(result.report.findings).toContainEqual(
          expect.objectContaining({
            ruleId: "doctor/partial-analysis",
            detailsSchema: "doctor.partial-analysis.v1",
            details: expect.objectContaining({
              analysisBudget: expect.objectContaining({ status, exceeded: [] }),
            }),
          }),
        );
      } finally {
        reportSpy.mockRestore();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("keeps unreadable input unknown when a file budget also skips later sources", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-failure-budget-"));
    try {
      await fs.writeFile(path.join(root, "package.json"), '{"name":"failure-budget"}');
      await fs.mkdir(path.join(root, "src"));
      const unreadable = path.join(root, "src/a.ts");
      await fs.writeFile(unreadable, 'import "react";\n');
      await fs.writeFile(path.join(root, "src/b.ts"), 'import "react";\n');
      const originalReadFile = fs.readFile;
      const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
        if (path.resolve(String(file)) === unreadable) throw new Error("fixture read failed");
        return originalReadFile(file, options);
      });
      try {
        const result = await analyze({
          root,
          include: ["src/*.ts"],
          analysisBudgets: { maxFiles: 1 },
          output: { formats: [] },
        });
        expect(result.facts.analysis?.status).toBe("unknown");
        expect(result.facts.analysis?.exceeded).toEqual([{ kind: "files", limit: 1 }]);
        expect(result.facts.imports.sourceReadFailures).toEqual(["src/a.ts"]);
        expect(result.facts.imports.unresolvedDynamic).toEqual([]);
        expect(result.exitCode).toBe(2);
      } finally {
        readFileSpy.mockRestore();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
