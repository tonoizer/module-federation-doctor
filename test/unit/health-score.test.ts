import { describe, expect, it } from "vitest";
import { computeHealthScore, isExcludedFromScore, labelForScore } from "../../src/health-score.js";
import type { DoctorFinding } from "../../src/types.js";

function finding(
  partial: Pick<DoctorFinding, "ruleId" | "severity"> &
    Partial<Omit<DoctorFinding, "ruleId" | "severity">>,
): DoctorFinding {
  return {
    schemaVersion: 1,
    message: partial.message ?? `${partial.ruleId} message`,
    project: partial.project ?? "demo",
    evidence: partial.evidence ?? {},
    fingerprint: partial.fingerprint ?? `${partial.ruleId}:${partial.severity}`,
    ...partial,
  };
}

describe("computeHealthScore", () => {
  it("scores a clean project 100 / Great", () => {
    expect(computeHealthScore([])).toEqual({ score: 100, scoreLabel: "Great" });
  });

  it("applies the unique-rule formula and clamps at 0", () => {
    // 2 unique errors + 1 unique warning → 100 - 3 - 0.75 = 96.25 → 96
    expect(
      computeHealthScore([
        finding({ ruleId: "config/name-required", severity: "error" }),
        finding({ ruleId: "config/expose-key-invalid", severity: "error" }),
        finding({ ruleId: "shared/singleton-mismatch", severity: "warning" }),
      ]),
    ).toEqual({ score: 96, scoreLabel: "Great" });

    // Many unique errors → clamp to 0
    const many = Array.from({ length: 80 }, (_, i) =>
      finding({ ruleId: `config/rule-${i}`, severity: "error" }),
    );
    expect(computeHealthScore(many)).toEqual({ score: 0, scoreLabel: "Needs work" });
  });

  it("does not double-penalize duplicate findings of the same rule id", () => {
    expect(
      computeHealthScore([
        finding({ ruleId: "config/name-required", severity: "error", fingerprint: "a" }),
        finding({ ruleId: "config/name-required", severity: "error", fingerprint: "b" }),
        finding({ ruleId: "config/name-required", severity: "error", fingerprint: "c" }),
      ]),
    ).toEqual({ score: 99, scoreLabel: "Great" }); // 100 - 1.5
  });

  it("excludes info, tooling, doctor/*, and suppressed findings", () => {
    expect(
      computeHealthScore([
        finding({ ruleId: "shared/candidate", severity: "info" }),
        finding({ ruleId: "doctor/plugin-missing", severity: "warning" }),
        finding({
          ruleId: "config/name-required",
          severity: "error",
          suppressed: true,
        }),
        // tooling category via guidance
        finding({ ruleId: "artifact/manifest-disabled", severity: "warning" }),
      ]),
    ).toEqual({ score: 100, scoreLabel: "Great" });
  });

  it("returns null when doctor/partial-analysis is present (non-suppressed)", () => {
    expect(
      computeHealthScore([
        finding({ ruleId: "doctor/partial-analysis", severity: "warning" }),
        finding({ ruleId: "config/name-required", severity: "error" }),
      ]),
    ).toEqual({ score: null, scoreLabel: null });

    // Suppressed partial-analysis does not null the score
    expect(
      computeHealthScore([
        finding({
          ruleId: "doctor/partial-analysis",
          severity: "warning",
          suppressed: true,
        }),
      ]),
    ).toEqual({ score: 100, scoreLabel: "Great" });
  });

  it("maps bands: ≥75 Great / ≥50 OK / else Needs work", () => {
    expect(labelForScore(100)).toBe("Great");
    expect(labelForScore(75)).toBe("Great");
    expect(labelForScore(74)).toBe("OK");
    expect(labelForScore(50)).toBe("OK");
    expect(labelForScore(49)).toBe("Needs work");
    expect(labelForScore(0)).toBe("Needs work");
  });

  it("marks exclusions for score surface", () => {
    expect(isExcludedFromScore(finding({ ruleId: "shared/candidate", severity: "info" }))).toBe(
      true,
    );
    expect(
      isExcludedFromScore(
        finding({ ruleId: "config/name-required", severity: "error", suppressed: true }),
      ),
    ).toBe(true);
    expect(
      isExcludedFromScore(finding({ ruleId: "config/name-required", severity: "error" })),
    ).toBe(false);
  });
});
