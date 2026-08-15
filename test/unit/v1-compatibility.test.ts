import { describe, expect, it } from "vitest";
import { applyBaseline } from "../../src/baseline.js";
import { projectV1Suppression } from "../../src/v1-compatibility.js";
import type { DoctorFinding } from "../../src/types.js";

const finding: DoctorFinding = {
  schemaVersion: 1,
  ruleId: "shared/singleton-mismatch",
  severity: "warning",
  message: "react versions diverge",
  project: "checkout",
  evidence: { package: "react" },
  fingerprint: "fingerprint-v1",
};
const lineageId = "mffinding:v1:0123456789abcdef01234567";

const waiverResolution = {
  schemaVersion: 1 as const,
  findingLineageId: lineageId,
  outcome: "suppressed" as const,
  suppressed: true,
  candidateWaiverIds: ["waiver-1"],
  appliedWaiverIds: ["waiver-1"],
  expiredWaiverIds: [],
  outOfScopeWaiverIds: [],
  unknownWaiverIds: [],
  decisions: [],
  missing: [],
  conflicts: [],
  reason: "one in-scope governance waiver applied",
  evaluatedAt: "2026-08-15T12:00:00.000Z",
};

describe("V1 suppression compatibility projection", () => {
  it("matches the unchanged baseline matcher and projects waiver-only suppression", () => {
    const baseline = {
      schemaVersion: 1 as const,
      entries: [
        {
          fingerprint: finding.fingerprint,
          ruleId: finding.ruleId,
          project: finding.project,
          reason: "accepted legacy debt",
        },
      ],
    };
    const legacy = applyBaseline([finding], baseline, { reportStale: false }).findings.find(
      (item) => item.fingerprint === finding.fingerprint,
    );
    const baselineProjection = projectV1Suppression({ finding, baseline });
    const waiverProjection = projectV1Suppression({
      finding,
      findingLineageId: lineageId,
      waiver: waiverResolution,
    });

    expect(baselineProjection.suppressed).toBe(legacy?.suppressed);
    expect(baselineProjection.suppressionReason).toBe(legacy?.suppressionReason);
    expect(baselineProjection.suppressionSource).toBe("baseline");
    expect(waiverProjection.suppressed).toBe(true);
    expect(waiverProjection.suppressionSource).toBe("waiver");
    expect(waiverProjection.suppressionReason).toBe("Governance waiver waiver-1");
    expect(waiverProjection.policyRelevant).toBe(false);
  });

  it("keeps baseline and waiver provenance separate without changing the legacy result", () => {
    const baseline = {
      schemaVersion: 1 as const,
      entries: [{ fingerprint: finding.fingerprint, reason: "legacy reason" }],
    };
    const projection = projectV1Suppression({
      finding,
      findingLineageId: lineageId,
      baseline,
      waiver: waiverResolution,
      failOnSuppressed: true,
    });
    expect(projection).toMatchObject({
      suppressed: true,
      suppressionSource: "baseline+waiver",
      suppressionReason: "legacy reason",
      baselineMatched: true,
      waiverApplied: true,
      waiverOutcome: "suppressed",
      policyRelevant: true,
    });
  });

  it("does not apply an ambiguous, unknown, or mismatched-lineage waiver", () => {
    const ambiguous = {
      ...waiverResolution,
      outcome: "ambiguous" as const,
      suppressed: false,
    };
    const unknown = {
      ...waiverResolution,
      outcome: "unknown" as const,
      suppressed: false,
    };
    expect(
      projectV1Suppression({ finding, findingLineageId: lineageId, waiver: ambiguous }),
    ).toMatchObject({ suppressed: false, waiverApplied: false, waiverOutcome: "ambiguous" });
    expect(
      projectV1Suppression({ finding, findingLineageId: lineageId, waiver: unknown }),
    ).toMatchObject({ suppressed: false, waiverApplied: false, waiverOutcome: "unknown" });
    expect(
      projectV1Suppression({
        finding,
        findingLineageId: "mffinding:v1:fedcba9876543210fedcba98",
        waiver: waiverResolution,
      }),
    ).toMatchObject({ suppressed: false, waiverApplied: false, waiverOutcome: "lineage-mismatch" });
  });

  it("does not mutate the finding or baseline input", () => {
    const baseline = {
      schemaVersion: 1 as const,
      entries: [{ fingerprint: finding.fingerprint }],
    };
    const findingBefore = structuredClone(finding);
    const baselineBefore = structuredClone(baseline);
    projectV1Suppression({ finding, baseline });
    expect(finding).toEqual(findingBefore);
    expect(baseline).toEqual(baselineBefore);
  });
});
