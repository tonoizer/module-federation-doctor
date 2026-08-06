import { describe, expect, it } from "vitest";
import {
  assertRegressionContract,
  compareRegressionContract,
  normalizeReport,
  REQUIRED_ANALYSIS_FIXTURES,
  REQUIRED_MODES,
  REQUIRED_WORKSPACE_FIXTURES,
} from "../../scripts/analysis-regression-contract.mjs";

function analysisRow(fixture: string, mode: string) {
  return {
    fixture,
    mode,
    rollout: { requestedMode: mode, selectedMode: mode, promotedBy: "test" },
    collector: { name: "v1", evidenceReaderMode: "separate-seam" },
    result: {
      exitCode: 0,
      report: {
        schemaVersion: 1,
        capabilities: {},
        summary: { projects: 1, info: 0, warnings: 0, errors: 0 },
        findings: [
          {
            ruleId: "rule/test",
            severity: "warning",
            project: fixture,
            fingerprint: `${fixture}-${mode}`,
            details: { stable: true },
            evidence: { sourceFile: "src/index.ts" },
          },
        ],
      },
      facts: {
        bundler: { name: "unknown" },
        project: { name: fixture, root: "." },
        moduleFederation: { name: fixture },
        imports: { sourceFiles: ["src/index.ts"] },
      },
      evidenceReader: { status: "read" },
    },
  };
}

function validContract() {
  return {
    schemaVersion: 1,
    analysis: REQUIRED_ANALYSIS_FIXTURES.flatMap((fixture) =>
      REQUIRED_MODES.map((mode) => analysisRow(fixture, mode)),
    ),
    workspaces: REQUIRED_WORKSPACE_FIXTURES.map((fixture) => ({
      fixture,
      result: {
        exitCode: 0,
        projects: [{ project: { name: "host" }, bundler: { name: "vite" } }],
        report: { schemaVersion: 1, capabilities: {}, summary: {}, findings: [] },
      },
    })),
  };
}

describe("analysis regression contract", () => {
  it("preserves finding schemas and rejects path traversal in bound values", () => {
    const report = normalizeReport(
      {
        schemaVersion: 1,
        capabilities: {},
        summary: {},
        findings: [
          {
            ruleId: "rule/test",
            severity: "warning",
            project: "small",
            fingerprint: "stable",
            detailsSchema: "rule.test.v1",
            details: { file: "src/index.ts" },
            evidence: { sourceFile: "src/index.ts" },
          },
        ],
      },
      "fixtures/analysis-budgets/small",
    );
    const findings = report.findings as Array<Record<string, unknown>>;
    expect(findings[0]).toMatchObject({
      detailsSchema: "rule.test.v1",
      details: { file: "src/index.ts" },
    });
    expect(() =>
      normalizeReport(
        {
          schemaVersion: 1,
          capabilities: {},
          summary: {},
          findings: [
            {
              ruleId: "rule/test",
              severity: "warning",
              project: "small",
              fingerprint: "stable",
              details: { file: "../outside.txt" },
              evidence: null,
            },
          ],
        },
        "fixtures/analysis-budgets/small",
      ),
    ).toThrow("contains traversal");
  });

  it("reports finding-detail and fact drift with stable fixture paths", () => {
    const expected = validContract();
    const actual = structuredClone(expected);
    actual.analysis[0]!.result.report.findings[0]!.details.stable = false;
    actual.analysis[0]!.result.facts.moduleFederation.name = "changed";

    expect(compareRegressionContract(expected, actual)).toEqual([
      'analysis/small/legacy.result.facts.moduleFederation.name: expected "small", received "changed"',
      "analysis/small/legacy.result.report.findings[0].details.stable: expected true, received false",
    ]);
  });

  it("rejects removed and unexpected required rows", () => {
    const removed = validContract();
    removed.analysis = removed.analysis.slice(1);
    expect(() => assertRegressionContract(removed, "removed")).toThrow("missing required row");

    const unexpected = validContract();
    unexpected.workspaces[0]!.fixture = "new";
    expect(() => assertRegressionContract(unexpected, "unexpected")).toThrow(
      "contains unexpected row",
    );
  });

  it("rejects malformed schema and duplicate expected/actual rows", () => {
    expect(() => assertRegressionContract({ schemaVersion: 2 }, "malformed")).toThrow(
      "schemaVersion must be 1",
    );

    const duplicateExpected = validContract();
    duplicateExpected.analysis.push(duplicateExpected.analysis[0]!);
    expect(() => compareRegressionContract(duplicateExpected, validContract())).toThrow(
      "duplicate row",
    );

    const duplicateActual = validContract();
    duplicateActual.workspaces.push(duplicateActual.workspaces[0]!);
    expect(() => compareRegressionContract(validContract(), duplicateActual)).toThrow(
      "duplicate row",
    );
  });

  it("keeps timing and RSS measurements outside the committed contract", () => {
    const expected = validContract();
    const actual = structuredClone(expected);
    expect(compareRegressionContract(expected, actual)).toEqual([]);
    expect(Object.hasOwn(actual.analysis[0]!.result, "elapsedMs")).toBe(false);
    expect(Object.hasOwn(actual.analysis[0]!.result, "rssBytes")).toBe(false);
  });
});
