import { describe, expect, it } from "vitest";
import {
  createApplicationIdentity,
  createContainerIdentity,
  createIdentityCapabilityEdge,
  createOrganizationIdentity,
} from "../../src/index.js";
import { buildSemanticGraph, buildSemanticUiPayload, querySemanticGraph } from "../../src/index.js";
import { buildUiPayload, reportFromFindings } from "../../src/ui-graph.js";
import type { ProjectFacts } from "../../src/types.js";

function project(name: string, identityKey?: string): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name, root: ".", ...(identityKey ? { identityKey } : {}) },
    bundler: { name: "vite", mode: "production" },
    capabilities: {
      config: true,
      sourceImports: false,
      manifest: false,
      stats: false,
      emittedAssets: false,
      installedVersions: true,
    },
    dependencies: { declared: {}, installed: {} },
    imports: {
      sourceFiles: [],
      specifiers: [],
      packages: [],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      evidenceSources: [],
    },
    artifacts: { emittedAssets: [] },
  };
}

describe("semantic graph bridge", () => {
  it("keeps semantic identities separate from same-named legacy projects", () => {
    const organization = createOrganizationIdentity(
      { organizationId: "acme" },
      { displayName: "Acme" },
    );
    const application = createApplicationIdentity(
      { organizationId: "acme", applicationId: "checkout" },
      { parentKey: organization.key, displayName: "checkout" },
    );
    const container = createContainerIdentity(
      { organizationId: "acme", applicationId: "checkout", containerName: "shop" },
      { parentKey: application.key, displayName: "shop" },
    );
    const edge = createIdentityCapabilityEdge({
      kind: "producer",
      fromKey: application.key,
      toKey: container.key,
      scope: { target: "browser" },
      outcome: "exact",
      completeness: "complete",
      evidenceIds: ["config-1"],
    });
    const graph = buildSemanticGraph({
      identities: [container, application, organization],
      edges: [edge],
      coverage: [
        {
          subjectKey: application.key,
          scope: { target: "browser" },
          expectedKinds: ["producer"],
        },
      ],
      legacyProjects: [project("checkout", application.key)],
    });

    expect(graph.nodes.map((node) => node.id)).toContain(application.key);
    expect(graph.nodes.filter((node) => node.kind === "legacy-project")).toHaveLength(1);
    expect(graph.nodes.find((node) => node.kind === "legacy-project")?.key).toBe(application.key);
    expect(graph.coverage[0]).toMatchObject({
      subjectKey: application.key,
      state: "complete",
      observedKinds: ["producer"],
    });
    expect(querySemanticGraph(graph, { kind: "application" }).nodes).toHaveLength(1);
    expect(
      querySemanticGraph(graph, { edgeKind: "producer", scope: { target: "browser" } }).edges,
    ).toEqual([
      expect.objectContaining({ id: edge.id, source: application.key, target: container.key }),
    ]);
  });

  it("marks indistinguishable V1 duplicates ambiguous and rejects unknown edge endpoints", () => {
    const duplicate = project("checkout");
    const graph = buildSemanticGraph({ legacyProjects: [duplicate, structuredClone(duplicate)] });
    expect(graph.legacyProjection.projects[0]).toMatchObject({
      project: "checkout",
      ambiguous: true,
    });
    expect(graph.nodes[0]).toMatchObject({ kind: "legacy-project", ambiguous: true });
    expect(() =>
      buildSemanticGraph({
        edges: [
          {
            schemaVersion: 1,
            id: "mfedge:v1:0123456789abcdef01234567",
            kind: "producer",
            fromKey: "mfid:v1:application:0123456789abcdef01234567",
            toKey: "mfid:v1:container:fedcba9876543210fedcba98",
            scope: { target: "browser" },
            outcome: "unknown",
            completeness: "unknown",
            evidenceIds: [],
          },
        ],
      }),
    ).toThrow("known identity nodes");
  });

  it("keeps the existing V1 UI payload byte-for-byte equivalent in the additive wrapper", () => {
    const facts = project("checkout");
    const report = reportFromFindings([facts], []);
    const legacy = buildUiPayload([facts], report);
    const wrapped = buildSemanticUiPayload([facts], report);
    expect(wrapped.legacy).toEqual(legacy);
    expect(wrapped.semantic.legacyProjection.projects[0]?.project).toBe("checkout");
  });
});
