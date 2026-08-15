import { createHash } from "node:crypto";
import type {
  AnySemanticIdentity,
  IdentityCompleteness,
  IdentityConfidence,
  IdentityKind,
  IdentityRealm,
  IdentityTarget,
} from "./identity.js";
import { IdentityValidationError } from "./identity.js";
import {
  assessIdentityCapabilityCoverage,
  isSemanticIdentityKey,
  type IdentityCapabilityCoverage,
  type IdentityCapabilityCoverageOptions,
  type IdentityCapabilityEdge,
  type IdentityCapabilityEdgeKind,
  type IdentityCorrelationOutcome,
  type IdentityCorrelationScope,
} from "./identity-correlation.js";
import { buildUiPayload } from "./ui-graph.js";
import type { DoctorReport, DoctorUiPayload, ProjectFacts } from "./types.js";
import { compareCodePoint, stableStringify } from "./utils.js";

/** Version of the additive semantic graph/query contract. */
export const SEMANTIC_GRAPH_SCHEMA_VERSION = 1 as const;
export type SemanticGraphSchemaVersion = typeof SEMANTIC_GRAPH_SCHEMA_VERSION;

export type SemanticGraphNodeKind = IdentityKind | "legacy-project";

export interface SemanticGraphNode {
  id: string;
  kind: SemanticGraphNodeKind;
  label: string;
  completeness: IdentityCompleteness;
  confidence: IdentityConfidence;
  key?: string;
  project?: string;
  target?: IdentityTarget;
  realm?: IdentityRealm;
  environmentKey?: string;
  ambiguous?: boolean;
}

export interface SemanticGraphEdge {
  id: string;
  kind: IdentityCapabilityEdgeKind;
  source: string;
  target: string;
  scope: IdentityCorrelationScope;
  outcome: IdentityCorrelationOutcome;
  completeness: IdentityCompleteness;
  evidenceIds: string[];
}

export interface SemanticGraphCoverage extends IdentityCapabilityCoverage {
  subjectKey: string;
}

export interface SemanticGraphLegacyProject {
  project: string;
  nodeId: string;
  identityKey?: string;
  federationGroup?: string;
  ambiguous: boolean;
}

export interface SemanticGraph {
  schemaVersion: SemanticGraphSchemaVersion;
  nodes: SemanticGraphNode[];
  edges: SemanticGraphEdge[];
  coverage: SemanticGraphCoverage[];
  legacyProjection: {
    projects: SemanticGraphLegacyProject[];
  };
}

export interface SemanticGraphCoverageRequest {
  subjectKey: string;
  scope: IdentityCapabilityCoverageOptions["scope"];
  expectedKinds?: readonly IdentityCapabilityEdgeKind[];
}

export interface SemanticGraphInput {
  identities?: readonly AnySemanticIdentity[];
  edges?: readonly IdentityCapabilityEdge[];
  coverage?: readonly SemanticGraphCoverageRequest[];
  /** V1 project facts are represented as explicitly legacy nodes. */
  legacyProjects?: readonly ProjectFacts[];
}

export interface SemanticGraphQuery {
  identityKey?: string;
  kind?: SemanticGraphNodeKind;
  edgeKind?: IdentityCapabilityEdgeKind;
  outcome?: IdentityCorrelationOutcome;
  scope?: IdentityCorrelationScope;
}

export interface SemanticGraphQueryResult {
  nodes: SemanticGraphNode[];
  edges: SemanticGraphEdge[];
  coverage: SemanticGraphCoverage[];
}

export interface SemanticUiPayload {
  schemaVersion: SemanticGraphSchemaVersion;
  /** Unchanged V1 graph/report projection for existing UI consumers. */
  legacy: DoctorUiPayload;
  semantic: SemanticGraph;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function optionalScope(identity: AnySemanticIdentity): IdentityCorrelationScope {
  const value = identity as unknown as Record<string, unknown>;
  const environmentKey =
    identity.kind === "environment"
      ? identity.key
      : identity.kind === "deployment"
        ? identity.parentKey
        : typeof value.environmentKey === "string"
          ? value.environmentKey
          : undefined;
  return {
    ...(typeof value.target === "string" ? { target: value.target as IdentityTarget } : {}),
    ...(typeof value.realm === "string" ? { realm: value.realm as IdentityRealm } : {}),
    ...(environmentKey === undefined ? {} : { environmentKey }),
  };
}

function nodeForIdentity(identity: AnySemanticIdentity): SemanticGraphNode {
  const scope = optionalScope(identity);
  return {
    id: identity.key,
    key: identity.key,
    kind: identity.kind,
    label: identity.displayName ?? identity.key,
    completeness: identity.completeness,
    confidence: identity.confidence,
    ...(scope.target === undefined ? {} : { target: scope.target }),
    ...(scope.realm === undefined ? {} : { realm: scope.realm }),
    ...(scope.environmentKey === undefined ? {} : { environmentKey: scope.environmentKey }),
  };
}

function legacyProjectId(project: ProjectFacts): string {
  return `legacy:v1:project:${digest(
    `${project.project.name}\u0000${project.project.federationGroup ?? ""}`,
  )}`;
}

function legacyNodes(projects: readonly ProjectFacts[]): {
  nodes: SemanticGraphNode[];
  projection: SemanticGraphLegacyProject[];
} {
  const grouped = new Map<string, ProjectFacts[]>();
  for (const project of projects) {
    const group = `${project.project.name}\u0000${project.project.federationGroup ?? ""}`;
    grouped.set(group, [...(grouped.get(group) ?? []), project]);
  }
  const entries = [...grouped.entries()].sort(([left], [right]) => compareCodePoint(left, right));
  const nodes: SemanticGraphNode[] = [];
  const projection: SemanticGraphLegacyProject[] = [];
  for (const [, groupedProjects] of entries) {
    const first = groupedProjects[0]!;
    const nodeId = legacyProjectId(first);
    const ambiguous = groupedProjects.length > 1;
    const identityKeys = [
      ...new Set(
        groupedProjects
          .map((project) => project.project.identityKey)
          .filter((value): value is string => isSemanticIdentityKey(value)),
      ),
    ].sort(compareCodePoint);
    nodes.push({
      id: nodeId,
      kind: "legacy-project",
      label: first.project.name,
      project: first.project.name,
      completeness: ambiguous ? "unknown" : "partial",
      confidence: "unknown",
      ...(identityKeys.length === 1 ? { key: identityKeys[0] } : {}),
      ...(ambiguous ? { ambiguous: true } : {}),
    });
    projection.push({
      project: first.project.name,
      nodeId,
      ...(identityKeys.length === 1 ? { identityKey: identityKeys[0] } : {}),
      ...(first.project.federationGroup ? { federationGroup: first.project.federationGroup } : {}),
      ambiguous,
    });
  }
  return { nodes, projection };
}

function edgeForGraph(
  edge: IdentityCapabilityEdge,
  knownKeys: ReadonlySet<string>,
): SemanticGraphEdge {
  if (!knownKeys.has(edge.fromKey) || !knownKeys.has(edge.toKey))
    throw new IdentityValidationError("semantic graph edges must reference known identity nodes.");
  return {
    id: edge.id,
    kind: edge.kind,
    source: edge.fromKey,
    target: edge.toKey,
    scope: { ...edge.scope },
    outcome: edge.outcome,
    completeness: edge.completeness,
    evidenceIds: [...edge.evidenceIds].sort(compareCodePoint),
  };
}

function scopeMatches(left: IdentityCorrelationScope, right: IdentityCorrelationScope): boolean {
  return (["target", "realm", "environmentKey"] as const).every(
    (name) => right[name] === undefined || left[name] === right[name],
  );
}

function sortGraph(graph: SemanticGraph): SemanticGraph {
  graph.nodes.sort((left, right) => compareCodePoint(left.id, right.id));
  graph.edges.sort((left, right) => compareCodePoint(left.id, right.id));
  graph.coverage.sort(
    (left, right) =>
      compareCodePoint(left.subjectKey, right.subjectKey) ||
      compareCodePoint(stableStringify(left.scope), stableStringify(right.scope)),
  );
  graph.legacyProjection.projects.sort((left, right) =>
    compareCodePoint(left.nodeId, right.nodeId),
  );
  return graph;
}

/**
 * Build an additive semantic graph from V2 identities/edges and explicitly
 * retained V1 project facts. Legacy projects never become semantic identities
 * by name alone, so mixed inputs cannot create a false exact relationship.
 */
export function buildSemanticGraph(input: SemanticGraphInput = {}): SemanticGraph {
  const identityMap = new Map<string, AnySemanticIdentity>();
  for (const identity of [...(input.identities ?? [])].sort((left, right) =>
    compareCodePoint(left.key, right.key),
  )) {
    if (!isSemanticIdentityKey(identity.key))
      throw new IdentityValidationError(
        "semantic graph identities must use semantic identity keys.",
      );
    const previous = identityMap.get(identity.key);
    if (previous && stableStringify(previous) !== stableStringify(identity))
      throw new IdentityValidationError(`duplicate semantic identity key: ${identity.key}`);
    identityMap.set(identity.key, identity);
  }
  const identityNodes = [...identityMap.values()].map(nodeForIdentity);
  const legacy = legacyNodes(input.legacyProjects ?? []);
  const nodes = [...identityNodes, ...legacy.nodes];
  const knownKeys = new Set(identityMap.keys());
  const validatedIdentityEdges = [...(input.edges ?? [])]
    .sort((left, right) => compareCodePoint(left.id, right.id))
    .map((edge) => {
      edgeForGraph(edge, knownKeys);
      return edge;
    });
  const edges = validatedIdentityEdges.map((edge) => edgeForGraph(edge, knownKeys));
  const coverage = (input.coverage ?? []).map((request) => {
    if (!knownKeys.has(request.subjectKey))
      throw new IdentityValidationError("semantic graph coverage must reference a known identity.");
    const result = assessIdentityCapabilityCoverage(validatedIdentityEdges, {
      scope: request.scope,
      ...(request.expectedKinds === undefined ? {} : { expectedKinds: request.expectedKinds }),
    });
    return Object.assign({ subjectKey: request.subjectKey }, result);
  });
  return sortGraph({
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    nodes,
    edges,
    coverage,
    legacyProjection: { projects: legacy.projection },
  });
}

/** Query semantic nodes and scoped capability edges without changing the V1 graph. */
export function querySemanticGraph(
  graph: SemanticGraph,
  query: SemanticGraphQuery = {},
): SemanticGraphQueryResult {
  if (query.identityKey !== undefined && !isSemanticIdentityKey(query.identityKey))
    throw new IdentityValidationError("semantic graph query identityKey must be semantic.");
  const nodes = graph.nodes.filter(
    (node) =>
      (query.identityKey === undefined ||
        node.key === query.identityKey ||
        node.id === query.identityKey) &&
      (query.kind === undefined || node.kind === query.kind) &&
      (query.scope === undefined || scopeMatches(node, query.scope)),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) =>
      (query.edgeKind === undefined || edge.kind === query.edgeKind) &&
      (query.outcome === undefined || edge.outcome === query.outcome) &&
      (query.scope === undefined || scopeMatches(edge.scope, query.scope)) &&
      (query.identityKey === undefined ||
        nodeIds.has(edge.source) ||
        nodeIds.has(edge.target) ||
        edge.source === query.identityKey ||
        edge.target === query.identityKey),
  );
  const coverage = graph.coverage.filter(
    (item) =>
      (query.identityKey === undefined || item.subjectKey === query.identityKey) &&
      (query.scope === undefined || scopeMatches(item.scope, query.scope)),
  );
  return {
    nodes: nodes.slice().sort((left, right) => compareCodePoint(left.id, right.id)),
    edges: edges.slice().sort((left, right) => compareCodePoint(left.id, right.id)),
    coverage: coverage
      .slice()
      .sort((left, right) => compareCodePoint(left.subjectKey, right.subjectKey)),
  };
}

/** Return an additive payload containing both semantic and unchanged V1 UI views. */
export function buildSemanticUiPayload(
  projects: readonly ProjectFacts[],
  report: DoctorReport,
  input: Omit<SemanticGraphInput, "legacyProjects"> = {},
): SemanticUiPayload {
  return {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    legacy: buildUiPayload([...projects], report),
    semantic: buildSemanticGraph({ ...input, legacyProjects: projects }),
  };
}

export type { IdentityCapabilityEdgeKind, IdentityCorrelationScope };
