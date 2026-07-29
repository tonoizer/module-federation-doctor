import { describe, expect, it } from "vitest";
import {
  canonicalIdentityKey,
  createAdapterTargetIdentity,
  createApplicationIdentity,
  createIdentity,
  createContainerIdentity,
  createDeploymentIdentity,
  createOrganizationIdentity,
  createEnvironmentIdentity,
  createRuntimeRealmIdentity,
  createRuntimeInstanceIdentity,
  IdentityValidationError,
  unknownIdentity,
} from "../../src/identity.js";
import { validatePayload } from "../helpers/schema-contract.js";

const org = createOrganizationIdentity({ organizationId: "acme" });
const app = createApplicationIdentity(
  { organizationId: "acme", applicationId: "checkout" },
  { parentKey: org.key },
);
const container = createContainerIdentity(
  { organizationId: "acme", applicationId: "checkout", containerName: "shop" },
  { parentKey: app.key },
);

const compileTimeIdentityChecks = (): void => {
  // @ts-expect-error Unsafe dimensions are rejected by the kind-specific TypeScript contract.
  canonicalIdentityKey("organization", { organizationId: "acme", root: "/tmp/app" });
};
void compileTimeIdentityChecks;

describe("semantic identities", () => {
  it("keeps parent and required discriminators in keys", () => {
    const otherApp = createApplicationIdentity(
      { organizationId: "acme", applicationId: "other" },
      { parentKey: org.key },
    );
    const otherContainer = createContainerIdentity(
      { organizationId: "acme", applicationId: "other", containerName: "shop" },
      { parentKey: otherApp.key },
    );
    expect(container.key).not.toBe(otherContainer.key);
    expect(
      createAdapterTargetIdentity(
        {
          organizationId: "acme",
          applicationId: "checkout",
          containerName: "shop",
          adapter: "vite",
          bundler: "vite",
          target: "browser",
        },
        { parentKey: container.key },
      ).key,
    ).not.toBe(
      createAdapterTargetIdentity(
        {
          organizationId: "acme",
          applicationId: "checkout",
          containerName: "shop",
          adapter: "vite",
          bundler: "vite",
          target: "ssr",
        },
        { parentKey: container.key },
      ).key,
    );
  });

  it("separates lanes, environments, redeploys, and realms", () => {
    const targetKey = createAdapterTargetIdentity(
      {
        organizationId: "acme",
        applicationId: "checkout",
        containerName: "shop",
        adapter: "vite",
        bundler: "vite",
        target: "browser",
      },
      { parentKey: container.key },
    ).key;
    const dimensions = {
      organizationId: "acme",
      applicationId: "checkout",
      adapterTargetKey: targetKey,
      lane: "web",
      target: "browser" as const,
      environment: "prod",
    };
    expect(canonicalIdentityKey("build-lineage", dimensions, targetKey)).not.toBe(
      canonicalIdentityKey("build-lineage", { ...dimensions, lane: "worker" }, targetKey),
    );
    expect(canonicalIdentityKey("build-lineage", dimensions, targetKey)).not.toBe(
      canonicalIdentityKey("build-lineage", { ...dimensions, environment: "staging" }, targetKey),
    );
    const lineageKey = canonicalIdentityKey("build-lineage", dimensions, targetKey);
    const buildKey = canonicalIdentityKey(
      "build",
      { buildLineageKey: lineageKey, buildId: "build-1" },
      lineageKey,
    );
    const artifactKey = canonicalIdentityKey(
      "artifact",
      { buildKey, artifactKind: "remote-entry", digest: `sha256:${"a".repeat(64)}` },
      buildKey,
    );
    const environment = createEnvironmentIdentity(
      { organizationId: "acme", environment: "prod" },
      { parentKey: org.key },
    );
    const deployment = createDeploymentIdentity(
      {
        environmentKey: environment.key,
        deploymentId: "deploy-1",
        artifactSetDigest: `sha256:${"a".repeat(64)}`,
        artifactKeys: [artifactKey, artifactKey],
      },
      { parentKey: environment.key },
    );
    expect(deployment.artifactKeys).toEqual([artifactKey]);
    const redeploy = createDeploymentIdentity(
      {
        environmentKey: environment.key,
        deploymentId: "deploy-2",
        artifactSetDigest: `sha256:${"a".repeat(64)}`,
        artifactKeys: [artifactKey],
      },
      { parentKey: environment.key },
    );
    expect(deployment.key).not.toBe(redeploy.key);
    const realm = createRuntimeRealmIdentity(
      { deploymentKey: deployment.key, realm: "node", realmId: "realm-1" },
      { parentKey: deployment.key },
    );
    const runtime = createRuntimeInstanceIdentity(
      {
        realmKey: realm.key,
        runtimeInstanceId: "runtime-1",
        runtimePackage: "mf",
        runtimeVersion: "1",
      },
      { parentKey: realm.key },
    );
    expect(runtime.key).not.toBe(
      createRuntimeInstanceIdentity(
        {
          realmKey: realm.key,
          runtimeInstanceId: "runtime-2",
          runtimePackage: "mf",
          runtimeVersion: "1",
        },
        { parentKey: realm.key },
      ).key,
    );
  });

  it("rejects empty, volatile-only, unsafe, non-finite, and oversized dimensions", () => {
    expect(() => canonicalIdentityKey("organization", {} as never)).toThrow(
      IdentityValidationError,
    );
    expect(() =>
      canonicalIdentityKey("organization", { organizationId: "/Users/alice/app" }),
    ).toThrow("Unsafe");
    expect(() =>
      canonicalIdentityKey("organization", { organizationId: "signed://cdn/x?sig=secret" }),
    ).toThrow("Unsafe");
    for (const value of [
      "https://user:password@example.com/org",
      "file:///tmp/org",
      "2026-07-29T12:00:00Z",
      "process-123",
      "session-abc",
      "pROCESS-123",
      "SESSION-abc",
    ]) {
      expect(() => canonicalIdentityKey("organization", { organizationId: value })).toThrow();
    }
    expect(() =>
      canonicalIdentityKey("organization", { organizationId: Number.NaN } as never),
    ).toThrow(IdentityValidationError);
    expect(() => canonicalIdentityKey("organization", { organizationId: "x".repeat(257) })).toThrow(
      "maxLength",
    );
    expect(() =>
      createOrganizationIdentity({ organizationId: "acme" }, { displayName: "x".repeat(257) }),
    ).toThrow("displayName");
    expect(() =>
      createApplicationIdentity(
        { organizationId: "acme", applicationId: "checkout" },
        { parentKey: org.key },
      ),
    ).not.toThrow();
    expect(() =>
      createContainerIdentity(
        { organizationId: "acme", applicationId: "checkout", containerName: "shop" },
        { parentKey: org.key },
      ),
    ).toThrow("parentKey");
    expect(() =>
      createIdentity({
        kind: "application",
        dimensions: { organizationId: "acme", applicationId: "checkout" },
      } as never),
    ).toThrow("parentKey");
  });

  it("makes generic occurrence identities schema-valid", async () => {
    const lineageKey = "mfid:v1:build-lineage:0123456789abcdef01234567";
    const build = createIdentity({
      kind: "build",
      dimensions: { buildLineageKey: lineageKey, buildId: "2026-07-29-build" },
      parentKey: lineageKey,
    });
    expect(build.occurrenceId).toBe("2026-07-29-build");
    await validatePayload("identity.schema.json", build, "generic build");

    const environmentKey = "mfid:v1:environment:0123456789abcdef01234567";
    const deployment = createIdentity({
      kind: "deployment",
      dimensions: {
        environmentKey,
        deploymentId: "2026-07-29-build",
        artifactSetDigest: `sha256:${"a".repeat(64)}`,
        artifactKeys: ["mfid:v1:artifact:0123456789abcdef01234567"],
      },
      parentKey: environmentKey,
    });
    expect(deployment.occurrenceId).toBe("2026-07-29-build");
    await validatePayload("identity.schema.json", deployment, "generic deployment");

    const realmKey = "mfid:v1:runtime-realm:0123456789abcdef01234567";
    const runtime = createIdentity({
      kind: "runtime-instance",
      dimensions: {
        realmKey,
        runtimeInstanceId: "2026-07-29-build",
        runtimePackage: "mf",
        runtimeVersion: "1",
      },
      parentKey: realmKey,
    });
    expect(runtime.occurrenceId).toBe("2026-07-29-build");
    await validatePayload("identity.schema.json", runtime, "generic runtime instance");
  });

  it("validates enums, typed parent references, and safe metadata", () => {
    expect(() =>
      canonicalIdentityKey(
        "build-lineage",
        {
          organizationId: "acme",
          applicationId: "checkout",
          adapterTargetKey: "mfid:v1:adapter-target:0123456789abcdef01234567",
          lane: "web",
          target: "invalid" as never,
          environment: "prod",
        },
        container.key,
      ),
    ).toThrow("target");
    expect(() =>
      canonicalIdentityKey(
        "build-lineage",
        {
          organizationId: "acme",
          applicationId: "checkout",
          adapterTargetKey: "mfid:v1:adapter-target:0123456789abcdef01234567",
          lane: "web",
          target: "browser",
          environment: "prod",
        },
        "mfid:v1:organization:0123456789abcdef01234567",
      ),
    ).toThrow("reference dimension");
    expect(() =>
      createOrganizationIdentity({ organizationId: "acme" }, { confidence: "invalid" as never }),
    ).toThrow("confidence");
    expect(() =>
      createOrganizationIdentity(
        { organizationId: "acme" },
        { provenance: { source: "invalid" as never } },
      ),
    ).toThrow("provenance.source");
    for (const value of [
      "prefixHTTPS://user:pass@example.test",
      "prefixFILE:///tmp/report",
      "prefix?TOKEN=secret",
      "Process-123",
      "SESSION-abc",
    ]) {
      expect(() =>
        createOrganizationIdentity(
          { organizationId: "acme" },
          { aliases: [value], provenance: { evidenceIds: [value] }, displayName: value },
        ),
      ).toThrow();
    }
  });

  it("uses bounded aliases/evidence and deterministic Unicode ordering", () => {
    const first = createOrganizationIdentity(
      { organizationId: "acme" },
      { aliases: ["é", "a"], provenance: { source: "config", evidenceIds: ["é", "a"] } },
    );
    const second = createOrganizationIdentity(
      { organizationId: "acme" },
      { aliases: ["a", "é"], provenance: { source: "config", evidenceIds: ["a", "é"] } },
    );
    expect(first.aliases).toEqual(["a", "é"]);
    expect(first).toEqual(second);
    expect(() =>
      createOrganizationIdentity(
        { organizationId: "acme" },
        { aliases: Array.from({ length: 17 }, (_, index) => String(index)) },
      ),
    ).toThrow("maxItems");
  });

  it("rejects unsafe unknown IDs and does not retain raw source data", () => {
    expect(() => unknownIdentity("deployment", "/tmp/report.json")).toThrow(
      IdentityValidationError,
    );
    expect(() => unknownIdentity("deployment", "https://cdn.example/a?signature=secret")).toThrow(
      IdentityValidationError,
    );
    const identity = unknownIdentity("application", "opaque-report-1");
    expect(JSON.stringify(identity)).not.toContain("opaque-report-1");
    expect(identity.completeness).toBe("unknown");
  });

  it("keeps every unknown child kind schema-valid", async () => {
    const kinds = [
      "organization",
      "application",
      "container",
      "adapter-target",
      "build-lineage",
      "build",
      "artifact",
      "environment",
      "deployment",
      "runtime-realm",
      "runtime-instance",
    ] as const;
    for (const kind of kinds)
      await validatePayload("identity.schema.json", unknownIdentity(kind, `opaque-${kind}`), kind);
  });
});
