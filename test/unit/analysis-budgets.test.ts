import { describe, expect, it } from "vitest";
import {
  AnalysisBudgetTracker,
  DEFAULT_ANALYSIS_BUDGETS,
  resolveAnalysisBudgets,
} from "../../src/analysis-budgets.js";

describe("analysis budgets", () => {
  it("has deterministic defaults and validates overrides", () => {
    expect(DEFAULT_ANALYSIS_BUDGETS).toEqual({
      maxFiles: 10_000,
      maxSourceBytes: 52_428_800,
      maxArtifacts: 10_000,
      maxEvidenceNodes: 100_000,
      maxSerializedBytes: 52_428_800,
      maxWallTimeMs: 30_000,
    });
    expect(resolveAnalysisBudgets({ maxFiles: 3, maxWallTimeMs: 7 })).toMatchObject({
      maxFiles: 3,
      maxWallTimeMs: 7,
      maxSourceBytes: 52_428_800,
      maxArtifacts: 10_000,
    });
    expect(() => resolveAnalysisBudgets({ maxFiles: -1 })).toThrow(/non-negative/);
    expect(() => resolveAnalysisBudgets({ maxFiles: 1.5 })).toThrow(/safe integer/);
  });

  it("does not partially reserve a file that breaks a limit", () => {
    const tracker = new AnalysisBudgetTracker(
      resolveAnalysisBudgets({ maxFiles: 1, maxSourceBytes: 4 }),
      { now: () => 1, startedAt: 1 },
    );
    expect(tracker.reserve({ files: 1, sourceBytes: 5 })).toBe(false);
    expect(tracker.reserve({ files: 1, sourceBytes: 4 })).toBe(true);
    expect(tracker.report()).toEqual({
      status: "partial",
      limits: resolveAnalysisBudgets({ maxFiles: 1, maxSourceBytes: 4 }),
      usage: { files: 1, sourceBytes: 4, artifacts: 0, evidenceNodes: 0, serializedBytes: 0 },
      exceeded: [{ kind: "sourceBytes", limit: 4 }],
    });
  });

  it("marks a wall-time cutoff without recording a timing value", () => {
    const tracker = new AnalysisBudgetTracker(resolveAnalysisBudgets({ maxWallTimeMs: 2 }), {
      now: () => 3,
      startedAt: 1,
    });
    expect(tracker.reserve({ files: 1 })).toBe(false);
    expect(tracker.report("unknown").exceeded).toEqual([{ kind: "wallTimeMs", limit: 2 }]);
  });

  it("reserves artifact records as one bounded unit", () => {
    const tracker = new AnalysisBudgetTracker(resolveAnalysisBudgets({ maxArtifacts: 1 }), {
      now: () => 1,
      startedAt: 1,
    });
    expect(tracker.reserve({ artifacts: 2 })).toBe(false);
    expect(tracker.reserve({ artifacts: 1 })).toBe(true);
    expect(tracker.report().exceeded).toEqual([{ kind: "artifacts", limit: 1 }]);
  });
});
