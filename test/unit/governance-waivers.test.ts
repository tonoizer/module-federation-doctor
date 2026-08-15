import { describe, expect, it } from "vitest";
import {
  createApplicationIdentity,
  createEnvironmentIdentity,
  createOrganizationIdentity,
} from "../../src/identity.js";
import { createFindingLineage } from "../../src/finding-lineage.js";
import {
  defineGovernanceWaiver,
  evaluateGovernanceWaiver,
  resolveGovernanceWaivers,
} from "../../src/governance-waivers.js";

const organization = createOrganizationIdentity({ organizationId: "acme" });
const application = createApplicationIdentity(
  { organizationId: "acme", applicationId: "checkout" },
  { parentKey: organization.key },
);
const environment = createEnvironmentIdentity(
  { organizationId: "acme", environment: "production" },
  { parentKey: organization.key },
);

function finding(outcome: "fail" | "unknown" = "fail") {
  return createFindingLineage({
    ruleId: "shared/singleton-mismatch",
    ruleVersion: "2.1.0",
    subjectKey: application.key,
    violationKey: "react",
    identityDimensions: { package: "react" },
    scope: { target: "browser", environmentKey: environment.key },
    outcome,
    completeness: outcome === "fail" ? "complete" : "partial",
    confidence: outcome === "fail" ? "strong" : "unknown",
    evidenceIds: ["evidence-1"],
  });
}

function waiver(overrides: Partial<Parameters<typeof defineGovernanceWaiver>[0]> = {}) {
  return defineGovernanceWaiver({
    id: "waiver-checkout-react",
    findingLineageId: finding().findingLineageId,
    ruleId: "shared/singleton-mismatch",
    subjectSelector: { identityKey: application.key, target: "browser" },
    owner: "team/checkout",
    reason: "legacy host migration is scheduled",
    ticket: "ENG-1234",
    approvedBy: "platform-owner",
    expiresAt: "2027-01-01T00:00:00.000Z",
    environments: ["production"],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("governance waivers", () => {
  it("applies an in-scope waiver and records a deterministic audit decision", () => {
    const record = finding();
    const defined = waiver({ findingLineageId: record.findingLineageId });
    const first = resolveGovernanceWaivers(record, [defined], {
      environment: "production",
      now: "2026-08-15T12:00:00.000Z",
    });
    const second = resolveGovernanceWaivers(record, [defined], {
      environment: "production",
      now: "2026-08-15T12:00:00.000Z",
    });

    expect(first).toEqual(second);
    expect(first.outcome).toBe("suppressed");
    expect(first.suppressed).toBe(true);
    expect(first.appliedWaiverIds).toEqual([defined.id]);
    expect(first.decisions[0]).toMatchObject({
      waiverId: defined.id,
      outcome: "applied",
      suppress: true,
      reason: "in-scope unexpired waiver matched",
    });
    expect(record.findingLineageId).toBe(defined.findingLineageId);
  });

  it("never suppresses expired, out-of-scope, or incomplete findings", () => {
    const record = finding();
    const expired = waiver({
      id: "waiver-expired",
      expiresAt: "2026-08-15T11:59:59.000Z",
    });
    const expiredDecision = evaluateGovernanceWaiver(record, expired, {
      environment: "production",
      now: "2026-08-15T12:00:00.000Z",
    });
    expect(expiredDecision.outcome).toBe("expired");
    expect(expiredDecision.suppress).toBe(false);

    const outOfScope = waiver({ id: "waiver-staging", environments: ["staging"] });
    const outOfScopeResolution = resolveGovernanceWaivers(record, [outOfScope], {
      environment: "production",
      now: "2026-08-15T12:00:00.000Z",
    });
    expect(outOfScopeResolution.outcome).toBe("not-suppressed");
    expect(outOfScopeResolution.outOfScopeWaiverIds).toEqual([outOfScope.id]);

    const incomplete = finding("unknown");
    const incompleteResolution = resolveGovernanceWaivers(
      incomplete,
      [
        waiver({
          id: "waiver-incomplete",
          findingLineageId: incomplete.findingLineageId,
        }),
      ],
      {
        environment: "production",
        now: "2026-08-15T12:00:00.000Z",
      },
    );
    expect(incompleteResolution.outcome).toBe("unknown");
    expect(incompleteResolution.suppressed).toBe(false);
  });

  it("retains overlapping approval conflicts instead of choosing a winner", () => {
    const record = finding();
    const first = waiver({ id: "waiver-owner-a" });
    const second = waiver({
      id: "waiver-owner-b",
      owner: "team/platform",
      reason: "platform migration is scheduled",
      ticket: "PLAT-77",
    });
    const result = resolveGovernanceWaivers(record, [second, first], {
      environment: "production",
      now: "2026-08-15T12:00:00.000Z",
    });
    expect(result.outcome).toBe("ambiguous");
    expect(result.suppressed).toBe(false);
    expect(result.appliedWaiverIds).toEqual(["waiver-owner-a", "waiver-owner-b"]);
    expect(result.conflicts).toContain("overlapping-waiver-decisions");
  });

  it("requires explicit subjects and rejects wildcard or sensitive waiver metadata", () => {
    expect(() =>
      defineGovernanceWaiver({
        id: "broad-waiver",
        ruleId: "shared/singleton-mismatch",
        subjectSelector: { kind: "application" },
        owner: "team/checkout",
        reason: "migration",
        ticket: "ENG-1",
        approvedBy: "platform-owner",
        expiresAt: "2027-01-01T00:00:00.000Z",
        environments: ["production"],
      }),
    ).toThrow();
    expect(() => waiver({ id: "wildcard-environment", environments: ["prod-*"] })).toThrow();
    expect(() => waiver({ id: "unsafe-ticket", ticket: "https://example.com/ENG-1" })).toThrow();
  });

  it("returns unknown when the required evaluation environment is absent", () => {
    const record = finding();
    const result = resolveGovernanceWaivers(record, [waiver({ id: "waiver-needs-environment" })], {
      now: "2026-08-15T12:00:00.000Z",
    });
    expect(result.outcome).toBe("unknown");
    expect(result.missing).toEqual(["environment"]);
    expect(result.suppressed).toBe(false);
  });
});
