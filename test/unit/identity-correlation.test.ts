import { describe, expect, it } from "vitest";
import {
  createAdapterTargetIdentity,
  createApplicationIdentity,
  createContainerIdentity,
  createEnvironmentIdentity,
  createOrganizationIdentity,
  createRuntimeInstanceIdentity,
  createRuntimeRealmIdentity,
  type SemanticIdentity,
} from "../../src/identity.js";
import {
  assessIdentityCapabilityCoverage,
  correlateSemanticIdentity,
  createIdentityCapabilityEdge,
  isIdentityCapabilityEdgeId,
} from "../../src/identity-correlation.js";

const org = createOrganizationIdentity({ organizationId: "acme" });
const app = createApplicationIdentity(
  { organizationId: "acme", applicationId: "checkout" },
  { parentKey: org.key },
);
const container = createContainerIdentity(
  { organizationId: "acme", applicationId: "checkout", containerName: "shop" },
  { parentKey: app.key },
);
const realm = createRuntimeRealmIdentity(
  {
    deploymentKey: "mfid:v1:deployment:0123456789abcdef01234567",
    realm: "node",
    realmId: "server",
  },
  { parentKey: "mfid:v1:deployment:0123456789abcdef01234567" },
);
const runtime = createRuntimeInstanceIdentity(
  { realmKey: realm.key, runtimeInstanceId: "runtime", runtimePackage: "mf", runtimeVersion: "1" },
  { parentKey: realm.key },
);

function withKey(
  identity: SemanticIdentity,
  digest: string,
  changes: Record<string, unknown> = {},
) {
  return {
    ...identity,
    ...changes,
    key: `mfid:v1:${identity.kind}:${digest}`,
  } as SemanticIdentity;
}

describe("semantic identity correlation", () => {
  it("returns exact and ambiguous outcomes without selecting a duplicate", () => {
    const exact = correlateSemanticIdentity(app, [app]);
    expect(exact.outcome).toBe("exact");
    expect(exact.candidates[0]?.matchedDimensions).toEqual(["key"]);

    const duplicate = correlateSemanticIdentity(app, [app, app]);
    expect(duplicate.outcome).toBe("ambiguous");
    expect(duplicate.candidates).toHaveLength(2);
    expect(duplicate.reason).toContain("multiple candidates");
  });

  it("distinguishes strong, weak, and unknown evidence", () => {
    const strong = withKey(runtime, "111111111111111111111111");
    expect(correlateSemanticIdentity(runtime, [strong]).outcome).toBe("strong");

    const weak = withKey(runtime, "222222222222222222222222", {
      runtimeInstanceId: "unknown",
      runtimePackage: "unknown",
      runtimeVersion: "unknown",
    });
    const weakResult = correlateSemanticIdentity(runtime, [weak]);
    expect(weakResult.outcome).toBe("weak");
    expect(weakResult.candidates[0]?.missingDimensions).toContain("runtimeVersion");

    const unrelated = withKey(runtime, "333333333333333333333333", {
      realmKey: "mfid:v1:runtime-realm:aaaaaaaaaaaaaaaaaaaaaaaa",
      runtimeInstanceId: "other",
      runtimePackage: "other",
      runtimeVersion: "2",
    });
    const unknown = correlateSemanticIdentity(runtime, [unrelated]);
    expect(unknown.outcome).toBe("unknown");
    expect(unknown.conflicts).toContain("realmKey");
  });

  it("keeps cross-target candidates out of a browser correlation", () => {
    const browser = createAdapterTargetIdentity(
      {
        organizationId: "acme",
        applicationId: "checkout",
        containerName: "shop",
        adapter: "vite",
        bundler: "vite",
        target: "browser",
      },
      { parentKey: container.key },
    );
    const ssr = createAdapterTargetIdentity(
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
    const result = correlateSemanticIdentity(browser, [ssr], { scope: { target: "browser" } });
    expect(result.outcome).toBe("unknown");
    expect(result.conflicts).toContain("scope.target");
  });

  it("sorts candidates deterministically, retains conflicts, and reports truncation", () => {
    const first = withKey(org, "aaaaaaaaaaaaaaaaaaaaaaaa", { displayName: "Acme" });
    const second = withKey(org, "bbbbbbbbbbbbbbbbbbbbbbbb", { displayName: "Acme" });
    const result = correlateSemanticIdentity(org, [second, first], { maxCandidates: 1 });
    expect(result.truncated).toBe(true);
    expect(result.candidateKeys).toEqual([first.key]);
    expect(result.reason).toContain("candidate limit");
    expect(() => correlateSemanticIdentity(org, [first], { maxCandidates: 101 })).toThrow();
  });
});

describe("scoped identity capability edges", () => {
  it("creates deterministic digest-only edge IDs and rejects same endpoints", () => {
    const environment = createEnvironmentIdentity(
      { organizationId: "acme", environment: "prod" },
      { parentKey: org.key },
    );
    const options = {
      kind: "producer" as const,
      fromKey: app.key,
      toKey: container.key,
      scope: { target: "browser" as const, environmentKey: environment.key },
      outcome: "exact" as const,
      completeness: "complete" as const,
      evidenceIds: ["config-1", "config-1"],
    };
    const first = createIdentityCapabilityEdge(options);
    const second = createIdentityCapabilityEdge({ ...options, evidenceIds: ["config-1"] });
    expect(first).toEqual(second);
    expect(isIdentityCapabilityEdgeId(first.id)).toBe(true);
    expect(first.id).not.toContain(app.key);
    expect(first.evidenceIds).toEqual(["config-1"]);
    expect(() => createIdentityCapabilityEdge({ ...options, toKey: app.key })).toThrow();
  });

  it("does not aggregate another target into scoped coverage", () => {
    const environment = createEnvironmentIdentity(
      { organizationId: "acme", environment: "prod" },
      { parentKey: org.key },
    );
    const producer = createIdentityCapabilityEdge({
      kind: "producer",
      fromKey: app.key,
      toKey: container.key,
      scope: { target: "ssr", environmentKey: environment.key },
      outcome: "exact",
      completeness: "complete",
    });
    const consumer = createIdentityCapabilityEdge({
      kind: "consumer",
      fromKey: container.key,
      toKey: app.key,
      scope: { target: "browser", environmentKey: environment.key },
      outcome: "exact",
      completeness: "complete",
    });
    const browser = assessIdentityCapabilityCoverage([producer, consumer], {
      scope: { target: "browser", environmentKey: environment.key },
      expectedKinds: ["producer", "consumer"],
    });
    expect(browser.state).toBe("partial");
    expect(browser.missingKinds).toEqual(["producer"]);
    expect(browser.observedEdges).toBe(1);

    const unscoped = assessIdentityCapabilityCoverage([consumer], {
      scope: {},
      expectedKinds: ["consumer"],
    });
    expect(unscoped.state).toBe("unknown");
  });
});
