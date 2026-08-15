import { describe, expect, it } from "vitest";
import {
  createAdapterTargetIdentity,
  createArtifactIdentity,
  createApplicationIdentity,
  createBuildIdentity,
  createBuildLineageIdentity,
  createContainerIdentity,
  createDeploymentIdentity,
  createEnvironmentIdentity,
  createOrganizationIdentity,
} from "../../src/identity.js";
import {
  correlateBuildArtifactDeployment,
  correlateDeploymentRelationship,
} from "../../src/build-artifact-deployment-correlation.js";

const digest = `sha256:${"a".repeat(64)}`;
const organization = createOrganizationIdentity({ organizationId: "acme" });
const application = createApplicationIdentity(
  { organizationId: "acme", applicationId: "checkout" },
  { parentKey: organization.key },
);
const container = createContainerIdentity(
  { organizationId: "acme", applicationId: "checkout", containerName: "shop" },
  { parentKey: application.key },
);
const adapterTarget = createAdapterTargetIdentity(
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
const buildLineage = createBuildLineageIdentity(
  {
    organizationId: "acme",
    applicationId: "checkout",
    adapterTargetKey: adapterTarget.key,
    lane: "web",
    target: "browser",
    environment: "production",
  },
  { parentKey: adapterTarget.key },
);
const build = createBuildIdentity(
  { buildLineageKey: buildLineage.key, buildId: "build-1" },
  { parentKey: buildLineage.key },
);
const artifact = createArtifactIdentity(
  { buildKey: build.key, artifactKind: "remote-entry", digest },
  { parentKey: build.key },
);
const environment = createEnvironmentIdentity(
  { organizationId: "acme", environment: "production" },
  { parentKey: organization.key },
);

function deployment(deploymentId: string, artifactSetDigest = digest) {
  return createDeploymentIdentity(
    {
      environmentKey: environment.key,
      deploymentId,
      artifactSetDigest,
      artifactKeys: [artifact.key],
    },
    { parentKey: environment.key },
  );
}

describe("build/artifact/deployment correlation", () => {
  it("joins explicit build, artifact, deployment, and environment links", () => {
    const result = correlateBuildArtifactDeployment({
      build,
      artifacts: [artifact],
      deployment: deployment("deploy-1"),
      environment,
      evidenceIds: ["build-evidence", "deployment-evidence"],
    });
    expect(result.outcome).toBe("exact");
    expect(result.completeness).toBe("complete");
    expect(result.confidence).toBe("exact");
    expect(result.missing).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.buildLineageKey).toBe(buildLineage.key);
  });

  it("keeps missing environment evidence weak instead of inventing it", () => {
    const result = correlateBuildArtifactDeployment({
      build,
      artifacts: [artifact],
      deployment: deployment("deploy-1"),
    });
    expect(result.outcome).toBe("weak");
    expect(result.completeness).toBe("partial");
    expect(result.missing).toContain("environment");
  });

  it("does not join an artifact from another build", () => {
    const otherBuild = createBuildIdentity(
      { buildLineageKey: buildLineage.key, buildId: "build-2" },
      { parentKey: buildLineage.key },
    );
    const foreignArtifact = createArtifactIdentity(
      { buildKey: otherBuild.key, artifactKind: "remote-entry", digest },
      { parentKey: otherBuild.key },
    );
    const result = correlateBuildArtifactDeployment({
      build,
      artifacts: [foreignArtifact],
      deployment: createDeploymentIdentity(
        {
          environmentKey: environment.key,
          deploymentId: "deploy-1",
          artifactSetDigest: digest,
          artifactKeys: [foreignArtifact.key],
        },
        { parentKey: environment.key },
      ),
      environment,
    });
    expect(result.outcome).toBe("unknown");
    expect(result.conflicts).toContain(`artifact.parentKey:${foreignArtifact.key}`);
  });

  it("validates explicit redeploy and rollback relationships", () => {
    const first = deployment("deploy-1");
    const second = deployment("deploy-2");
    expect(
      correlateDeploymentRelationship({
        deployment: second,
        relatedDeployment: first,
        relation: "redeploy",
      }),
    ).toMatchObject({ relation: "redeploy", outcome: "exact", conflicts: [] });
    expect(
      correlateDeploymentRelationship({
        deployment: second,
        relatedDeployment: first,
        relation: "rollback",
      }),
    ).toMatchObject({ relation: "rollback", outcome: "exact", conflicts: [] });
    expect(
      correlateDeploymentRelationship({
        deployment: second,
        relatedDeployment: deployment("deploy-3", `sha256:${"b".repeat(64)}`),
        relation: "rollback",
      }),
    ).toMatchObject({ outcome: "unknown", conflicts: ["artifactSetDigest"] });
  });
});
