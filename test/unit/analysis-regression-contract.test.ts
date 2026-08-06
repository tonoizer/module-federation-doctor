import { describe, expect, it } from "vitest";
import { compareRegressionContract } from "../../scripts/analysis-regression-contract.mjs";

describe("analysis regression contract", () => {
  it("reports stable fixture and field paths for semantic drift", () => {
    const expected = {
      schemaVersion: 1,
      analysis: [
        {
          fixture: "small",
          mode: "legacy",
          result: { exitCode: 0, report: { summary: { warnings: 1 } } },
        },
      ],
      workspaces: [],
    };
    const actual = {
      schemaVersion: 1,
      analysis: [
        {
          fixture: "small",
          mode: "legacy",
          result: { exitCode: 1, report: { summary: { warnings: 2 } } },
        },
      ],
      workspaces: [],
    };

    expect(compareRegressionContract(expected, actual)).toEqual([
      "analysis/small/legacy.result.exitCode: expected 0, received 1",
      "analysis/small/legacy.result.report.summary.warnings: expected 1, received 2",
    ]);
  });

  it("detects missing and unexpected workspace rows", () => {
    const expected = {
      schemaVersion: 1,
      analysis: [],
      workspaces: [{ fixture: "clean", result: { exitCode: 0 } }],
    };
    const actual = {
      schemaVersion: 1,
      analysis: [],
      workspaces: [{ fixture: "new", result: { exitCode: 0 } }],
    };

    expect(compareRegressionContract(expected, actual)).toEqual([
      "workspace/clean: expected benchmark row is missing",
      "workspace/new: unexpected benchmark row",
    ]);
  });

  it("does not compare volatile benchmark measurements", () => {
    const contract = {
      schemaVersion: 1,
      analysis: [{ fixture: "small", mode: "legacy", result: { exitCode: 0 } }],
      workspaces: [],
    };
    expect(compareRegressionContract(contract, structuredClone(contract))).toEqual([]);
  });
});
