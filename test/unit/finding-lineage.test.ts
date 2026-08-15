import { describe, expect, it } from "vitest";
import {
  createFindingHistorySnapshot,
  createFindingLineage,
  diffFindingHistory,
  diffFindingHistorySeries,
} from "../../src/finding-lineage.js";

const subjectKey = "mfid:v1:application:0123456789abcdef01234567";
const buildKey = "mfid:v1:build:fedcba9876543210fedcba98";
const deploymentKey = "mfid:v1:deployment:abcdefabcdefabcdefabcdef";

function finding(
  outcome: "pass" | "fail" | "unknown" = "fail",
  severity: "info" | "warning" | "error" = "warning",
  violationKey = "react",
) {
  return createFindingLineage({
    ruleId: "shared/singleton-mismatch",
    ruleVersion: "2.1.0",
    subjectKey,
    violationKey,
    identityDimensions: { package: "react", shareScope: ["default", "legacy"] },
    scope: { target: "browser", buildKey, deploymentKey },
    outcome,
    completeness: outcome === "unknown" ? "partial" : "complete",
    confidence: outcome === "unknown" ? "unknown" : "strong",
    evidenceIds: ["evidence-b", "evidence-a"],
    occurrenceKey: "build-occurrence-1",
    severity,
  });
}

describe("finding lineage and history", () => {
  it("keeps semantic lineage stable while occurrences follow explicit evaluation evidence", () => {
    const first = finding("fail", "warning");
    const second = createFindingLineage({
      ruleId: first.rule.id,
      ruleVersion: first.rule.version,
      subjectKey: first.subjectKey,
      violationKey: first.violationKey,
      identityDimensions: first.identityDimensions,
      ...(first.scope ? { scope: first.scope } : {}),
      outcome: "fail",
      completeness: "complete",
      confidence: "exact",
      evidenceIds: ["evidence-c"],
      severity: "error",
    });

    expect(second.findingLineageId).toBe(first.findingLineageId);
    expect(second.findingOccurrenceId).not.toBe(first.findingOccurrenceId);
    expect(first.identityDimensions).toEqual({
      package: "react",
      shareScope: ["default", "legacy"],
    });
    expect(first.occurrenceBasis).toBe("explicit");
  });

  it("does not put source messages, locations, or timestamps into lineage material", () => {
    const first = finding();
    const second = createFindingLineage({
      ruleId: first.rule.id,
      ruleVersion: first.rule.version,
      subjectKey: first.subjectKey,
      violationKey: first.violationKey,
      identityDimensions: { package: "react", shareScope: ["legacy", "default"] },
      ...(first.scope ? { scope: first.scope } : {}),
      outcome: "fail",
      completeness: "complete",
      confidence: "strong",
      evidenceIds: ["evidence-new"],
      occurrenceKey: "build-occurrence-2",
      severity: "warning",
    });
    expect(second.findingLineageId).toBe(first.findingLineageId);
    expect(() =>
      createFindingLineage({
        ruleId: first.rule.id,
        ruleVersion: first.rule.version,
        subjectKey: "checkout",
        violationKey: first.violationKey,
        outcome: "fail",
        completeness: "complete",
        confidence: "strong",
      }),
    ).toThrow();
    expect(() =>
      createFindingLineage({
        ruleId: first.rule.id,
        ruleVersion: first.rule.version,
        subjectKey: first.subjectKey,
        violationKey: first.violationKey,
        identityDimensions: { message: "volatile" },
        outcome: "fail",
        completeness: "complete",
        confidence: "strong",
      }),
    ).toThrow();
    expect(() =>
      createFindingLineage({
        ruleId: first.rule.id,
        ruleVersion: first.rule.version,
        subjectKey: first.subjectKey,
        violationKey: first.violationKey,
        occurrenceKey: "2026-08-15T12:00:00Z",
        outcome: "fail",
        completeness: "complete",
        confidence: "strong",
      }),
    ).toThrow();
  });

  it("reports new, persistent, improved, regressed, and resolved states", () => {
    const persistent = finding("fail", "warning");
    const improved = finding("fail", "info");
    const resolved = finding("pass", "info");
    const newFailure = finding("fail", "error", "vue");
    const previous = createFindingHistorySnapshot({
      snapshotId: "snapshot-before",
      completeness: "complete",
      comparable: true,
      evaluations: [persistent, newFailure],
    });
    const next = createFindingHistorySnapshot({
      snapshotId: "snapshot-after",
      completeness: "complete",
      comparable: true,
      evaluations: [improved],
    });
    const diff = diffFindingHistory(previous, next);
    const byState = new Map(diff.changes.map((item) => [item.findingLineageId, item.state]));

    expect(byState.get(persistent.findingLineageId)).toBe("improved");
    expect(byState.get(newFailure.findingLineageId)).toBe("resolved");
    expect(diff.comparable).toBe(true);

    const regression = diffFindingHistory(
      createFindingHistorySnapshot({
        snapshotId: "snapshot-pass",
        completeness: "complete",
        comparable: true,
        evaluations: [resolved],
      }),
      createFindingHistorySnapshot({
        snapshotId: "snapshot-fail",
        completeness: "complete",
        comparable: true,
        evaluations: [persistent],
      }),
    );
    expect(regression.changes[0]?.state).toBe("regressed");
  });

  it("keeps history unknown when later evidence is partial", () => {
    const before = createFindingHistorySnapshot({
      snapshotId: "snapshot-before",
      completeness: "complete",
      comparable: true,
      evaluations: [finding("fail")],
    });
    const after = createFindingHistorySnapshot({
      snapshotId: "snapshot-partial",
      completeness: "partial",
      comparable: false,
      missing: ["deployment evidence"],
      evaluations: [],
    });
    const diff = diffFindingHistory(before, after);
    expect(diff.comparable).toBe(false);
    expect(diff.changes[0]?.state).toBe("unknown/unconfirmed");
    expect(diff.changes[0]?.reason).toContain("comparable");
  });

  it("diffs a deterministic multi-snapshot series", () => {
    const before = createFindingHistorySnapshot({
      snapshotId: "snapshot-1",
      completeness: "complete",
      comparable: true,
      evaluations: [],
    });
    const after = createFindingHistorySnapshot({
      snapshotId: "snapshot-2",
      completeness: "complete",
      comparable: true,
      evaluations: [finding("fail")],
    });
    const later = createFindingHistorySnapshot({
      snapshotId: "snapshot-3",
      completeness: "complete",
      comparable: true,
      evaluations: [finding("pass")],
    });
    const diffs = diffFindingHistorySeries([before, after, later]);
    expect(diffs).toHaveLength(2);
    expect(diffs[0]?.changes[0]?.state).toBe("new");
    expect(diffs[1]?.changes[0]?.state).toBe("resolved");
  });
});
