import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";
import { failAfterCollect } from "../../src/plugin.js";
import { defineRule } from "../../src/rules.js";
import type { DoctorFinding, DoctorReport } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("collect-all-then-fail", () => {
  it("keeps sibling rule findings when one rule throws", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-collect-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"collect-all"}');

    const boom = defineRule({
      meta: {
        id: "test/throws",
        defaultSeverity: "error",
        supportedBundlers: ["unknown", "vite", "rspack", "rsbuild"],
        documentation: "/rules/test/throws",
        category: "tooling",
        impact: "test",
        fix: "test",
        sources: [],
      },
      check() {
        throw new Error("boom");
      },
    });

    const result = await analyze({
      root,
      moduleFederation: { name: "" },
      mode: "ci",
      output: { formats: [] },
      extends: [boom],
      rules: {
        "doctor/partial-analysis": "off",
        "config/plugin-package-mismatch": "off",
      },
    });

    expect(result.report.findings.some((item) => item.ruleId === "config/name-required")).toBe(
      true,
    );
    expect(result.report.findings.some((item) => item.ruleId === "test/throws")).toBe(true);
    expect(result.report.findings.length).toBeGreaterThan(1);
    expect(result.exitCode).toBe(1);
  });

  it("throws once with every finding listed after collection", () => {
    const findings: DoctorFinding[] = [
      {
        schemaVersion: 1,
        ruleId: "config/name-required",
        severity: "error",
        message: "name is required",
        project: "demo",
        evidence: {},
        documentation: "/rules/config/name-required",
        fingerprint: "a",
      },
      {
        schemaVersion: 1,
        ruleId: "shared/singleton-risk",
        severity: "warning",
        message: "singleton risk",
        project: "demo",
        evidence: {},
        documentation: "/rules/shared/singleton-risk",
        fingerprint: "b",
      },
      {
        schemaVersion: 1,
        ruleId: "shared/version-unsatisfied",
        severity: "error",
        message: "version unsatisfied",
        project: "demo",
        evidence: {},
        documentation: "/rules/shared/version-unsatisfied",
        fingerprint: "c",
      },
    ];
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
      summary: { projects: 1, info: 0, warnings: 1, errors: 2 },
      findings,
    };

    expect(() =>
      failAfterCollect({
        facts: {
          schemaVersion: 1,
          project: { name: "demo", root: "." },
          bundler: { name: "vite", mode: "ci" },
          capabilities: report.capabilities,
          dependencies: { declared: {}, installed: {} },
          imports: { sourceFiles: [], specifiers: [], packages: [] },
          artifacts: { emittedAssets: [] },
        },
        report,
        exitCode: 1,
      }),
    ).toThrow(
      /config\/name-required[\s\S]*shared\/singleton-risk[\s\S]*shared\/version-unsatisfied/,
    );
  });
});
