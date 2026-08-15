import { describe, expect, it } from "vitest";
import {
  createAdapterTargetIdentity,
  createApplicationIdentity,
  createContainerIdentity,
  createOrganizationIdentity,
  type SemanticIdentity,
} from "../../src/identity.js";
import {
  defineIdentityGovernanceRule,
  resolveIdentityGovernance,
} from "../../src/identity-governance.js";

const organization = createOrganizationIdentity({ organizationId: "acme" });
const application = createApplicationIdentity(
  { organizationId: "acme", applicationId: "checkout" },
  { parentKey: organization.key },
);
const container = createContainerIdentity(
  { organizationId: "acme", applicationId: "checkout", containerName: "shop" },
  { parentKey: application.key },
);

function alternateKey(identity: SemanticIdentity): SemanticIdentity {
  return {
    ...identity,
    key: `mfid:v1:${identity.kind}:fedcba9876543210fedcba98`,
  };
}

describe("portable identity governance", () => {
  it("resolves an exact identity rule and normalizes evidence", () => {
    const rule = defineIdentityGovernanceRule({
      id: "owner-checkout",
      responsibility: "consumer",
      owner: "team/checkout",
      selector: { identityKey: application.key },
      evidenceIds: ["governance-1", "governance-1"],
    });
    const result = resolveIdentityGovernance(application, [rule]);
    expect(result.outcome).toBe("resolved");
    expect(result.owners).toEqual(["team/checkout"]);
    expect(result.responsibilities).toEqual(["consumer"]);
    expect(result.matchedRuleIds).toEqual(["owner-checkout"]);
    expect(result.evidenceIds).toEqual(["governance-1"]);
    expect(result.completeness).toBe("complete");
  });

  it("uses selector specificity before priority and priority within a tier", () => {
    const broad = defineIdentityGovernanceRule({
      id: "broad-app",
      responsibility: "deployment",
      owner: "team/platform",
      selector: { kind: "application" },
      priority: 100,
    });
    const exact = defineIdentityGovernanceRule({
      id: "exact-app",
      responsibility: "consumer",
      owner: "team/checkout",
      selector: { identityKey: application.key },
      priority: 0,
    });
    expect(resolveIdentityGovernance(application, [broad, exact]).owners).toEqual([
      "team/checkout",
    ]);

    const low = defineIdentityGovernanceRule({
      id: "container-low",
      responsibility: "producer",
      owner: "team/low",
      selector: { kind: "container", containerName: "shop" },
      priority: 1,
    });
    const high = defineIdentityGovernanceRule({
      id: "container-high",
      responsibility: "producer",
      owner: "team/high",
      selector: { kind: "container", containerName: "shop" },
      priority: 2,
    });
    expect(resolveIdentityGovernance(container, [low, high]).owners).toEqual(["team/high"]);
  });

  it("retains equal-precedence ownership conflicts instead of choosing a winner", () => {
    const first = defineIdentityGovernanceRule({
      id: "owner-a",
      responsibility: "consumer",
      owner: "team/a",
      selector: { identityKey: application.key },
    });
    const second = defineIdentityGovernanceRule({
      id: "owner-b",
      responsibility: "producer",
      owner: "team/b",
      selector: { identityKey: application.key },
    });
    const result = resolveIdentityGovernance(application, [second, first]);
    expect(result.outcome).toBe("ambiguous");
    expect(result.owners).toEqual(["team/a", "team/b"]);
    expect(result.matchedRuleIds).toEqual(["owner-a", "owner-b"]);
    expect(result.conflicts).toEqual(["equal-precedence-governance-rules"]);
  });

  it("does not resolve incomplete governance evidence", () => {
    const partial = defineIdentityGovernanceRule({
      id: "partial-owner",
      responsibility: "runtime-platform",
      owner: "team/runtime",
      selector: { identityKey: application.key },
      completeness: "partial",
    });
    const result = resolveIdentityGovernance(application, [partial]);
    expect(result.outcome).toBe("unknown");
    expect(result.incompleteRuleIds).toEqual(["partial-owner"]);
    expect(result.missing).toEqual(["complete-governance-evidence"]);
    expect(result.conflicts).toEqual(["incomplete-governance-evidence"]);
  });

  it("isolates target scope and refuses unknown scope dimensions", () => {
    const target = createAdapterTargetIdentity(
      {
        organizationId: "acme",
        applicationId: "checkout",
        containerName: "shop",
        adapter: "vite",
        bundler: "vite",
        target: "ssr",
      },
      { parentKey: container.key },
    );
    const rule = defineIdentityGovernanceRule({
      id: "target-owner",
      responsibility: "runtime-platform",
      owner: "team/ssr",
      selector: { kind: "adapter-target" },
    });
    const result = resolveIdentityGovernance(target, [rule], { scope: { target: "browser" } });
    expect(result.outcome).toBe("unknown");
    expect(result.conflicts).toEqual(["scope.target"]);

    const unknownScopeResult = resolveIdentityGovernance(
      alternateKey({ ...target, target: undefined } as unknown as SemanticIdentity),
      [rule],
      { scope: { target: "browser" } },
    );
    expect(unknownScopeResult.outcome).toBe("unknown");
    expect(unknownScopeResult.missing).toEqual(["scope.target"]);
  });

  it("rejects unsafe rule metadata and bounded rule floods", () => {
    expect(() =>
      defineIdentityGovernanceRule({
        id: "owner",
        responsibility: "consumer",
        owner: "https://example.com/team",
        selector: { identityKey: application.key },
      }),
    ).toThrow();
    const rules = Array.from({ length: 2 }, (_, index) =>
      defineIdentityGovernanceRule({
        id: `rule-${index}`,
        responsibility: "consumer",
        owner: "team/checkout",
        selector: { kind: "application" },
      }),
    );
    expect(() => resolveIdentityGovernance(application, rules, { maxRules: 1 })).toThrow();
  });
});
