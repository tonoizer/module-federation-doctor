import type {
  DoctorFinding,
  DoctorReport,
  DoctorUiPayload,
  ProjectFacts,
  Severity,
  UiGraph,
  UiGraphEdge,
  UiGraphNode,
} from "./types.js";
import { summarizeFindings } from "./baseline.js";
import { computeHealthScore } from "./health-score.js";
import { buildFederationModel, type FederationModel } from "./federation-model.js";

function emptyGraph(): UiGraph {
  return { nodes: [], edges: [] };
}

function worstSeverity(left: Severity | undefined, right: Severity): Severity {
  const rank = { error: 3, warning: 2, info: 1 } as const;
  if (!left) return right;
  return rank[left] >= rank[right] ? left : right;
}

function findingScopeKey(project: string, instanceId?: string): string {
  return `${project}\0${instanceId ?? ""}`;
}

function findingsByProject(findings: DoctorFinding[]): Map<string, Severity> {
  const map = new Map<string, Severity>();
  for (const finding of findings)
    map.set(
      findingScopeKey(finding.project, finding.federationInstanceId),
      worstSeverity(
        map.get(findingScopeKey(finding.project, finding.federationInstanceId)),
        finding.severity,
      ),
    );
  return map;
}

function findingsByPackage(findings: DoctorFinding[]): Map<string, Severity> {
  const map = new Map<string, Severity>();
  for (const finding of findings) {
    const packageName = finding.evidence.package;
    if (typeof packageName === "string")
      map.set(
        findingScopeKey(packageName, finding.federationInstanceId),
        worstSeverity(
          map.get(findingScopeKey(packageName, finding.federationInstanceId)),
          finding.severity,
        ),
      );
  }
  return map;
}

function scopedSeverity(
  map: Map<string, Severity>,
  name: string,
  instanceId?: string,
): Severity | undefined {
  return map.get(findingScopeKey(name, instanceId)) ?? map.get(findingScopeKey(name));
}

function encodedGroup(group: string | undefined): string | undefined {
  return group ? encodeURIComponent(group) : undefined;
}

function projectNodeId(project: ProjectFacts, instanceId?: string): string {
  const group = encodedGroup(project.project.federationGroup);
  const base = group
    ? `project:group:${group}:${project.project.name}`
    : `project:${project.project.name}`;
  return instanceId ? `${base}:instance:${instanceId}` : base;
}

function remoteNodeId(
  consumer: string,
  remoteName: string,
  group?: string,
  instanceId?: string,
): string {
  const scope = encodedGroup(group);
  const base = scope
    ? `remote:group:${scope}:${consumer}:${remoteName}`
    : `remote:${consumer}:${remoteName}`;
  return instanceId ? `${base}:instance:${instanceId}` : base;
}

function sharedNodeId(packageName: string, group?: string, instanceId?: string): string {
  const scope = encodedGroup(group);
  const base = scope ? `shared:group:${scope}:${packageName}` : `shared:${packageName}`;
  return instanceId ? `${base}:instance:${instanceId}` : base;
}

function exposeNodeId(project: ProjectFacts, exposeKey: string, instanceId?: string): string {
  return `expose:${projectNodeId(project, instanceId)}:${exposeKey}`;
}

function runtimeNodeId(group?: string): string {
  const scope = encodedGroup(group);
  return scope ? `runtime:external:${scope}` : "runtime:external";
}

function withSeverity<T extends object>(
  value: T,
  severity: Severity | undefined,
): T & { severity?: Severity } {
  return severity ? { ...value, severity } : value;
}

function addNode(nodes: Map<string, UiGraphNode>, node: UiGraphNode): void {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, node);
    return;
  }
  const severity =
    existing.severity || node.severity
      ? worstSeverity(existing.severity, node.severity ?? "info")
      : undefined;
  nodes.set(
    node.id,
    withSeverity(
      {
        ...existing,
        ...node,
        meta: { ...existing.meta, ...node.meta },
      },
      severity,
    ),
  );
}

function addEdge(edges: Map<string, UiGraphEdge>, edge: UiGraphEdge): void {
  if (!edges.has(edge.id)) edges.set(edge.id, edge);
}

function buildRemotesGraph(findings: DoctorFinding[], federation: FederationModel): UiGraph {
  const nodes = new Map<string, UiGraphNode>();
  const edges = new Map<string, UiGraphEdge>();
  const projectSeverity = findingsByProject(findings);
  for (const node of federation.projects) {
    const project = node.project;
    const config = node.instance?.moduleFederation ?? project.moduleFederation;
    const scopedProjectId = projectNodeId(project, node.instanceId);
    addNode(
      nodes,
      withSeverity(
        {
          id: scopedProjectId,
          label: config?.name ? `${project.project.name} (${config.name})` : project.project.name,
          kind: "project" as const,
          project: project.project.name,
          meta: {
            bundler: project.bundler.name,
            exposes: Object.keys(config?.exposes ?? {}).length,
            remotes: Object.keys(config?.remotes ?? {}).length,
            ...(node.instanceId ? { federationInstanceId: node.instanceId } : {}),
          },
        },
        scopedSeverity(projectSeverity, project.project.name, node.instanceId),
      ),
    );
  }

  const projectsById = new Map(federation.projects.map((node) => [node.id, node] as const));
  for (const edge of federation.remoteEdges) {
    const sourceNode = projectsById.get(edge.fromId);
    const targetNode = edge.targetId ? projectsById.get(edge.targetId) : undefined;
    const targetId = targetNode
      ? projectNodeId(targetNode.project, targetNode.instanceId)
      : remoteNodeId(
          edge.fromProject,
          edge.remoteName,
          sourceNode?.federationGroup,
          edge.fromInstanceId,
        );
    if (!targetNode)
      addNode(nodes, {
        id: targetId,
        label: edge.remoteName,
        kind: "remote",
        meta: {
          entry: edge.entry,
          shareScope: edge.shareScope,
          alias: edge.alias,
          ...(edge.fromInstanceId ? { federationInstanceId: edge.fromInstanceId } : {}),
        },
      });
    const source = sourceNode
      ? projectNodeId(sourceNode.project, sourceNode.instanceId)
      : `project:${edge.fromProject}`;
    addEdge(edges, {
      id: `${source}->${targetId}`,
      source,
      target: targetId,
      label: edge.alias ?? edge.remoteName,
    });
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function buildSharedGraph(findings: DoctorFinding[], federation: FederationModel): UiGraph {
  const nodes = new Map<string, UiGraphNode>();
  const edges = new Map<string, UiGraphEdge>();
  const packageSeverity = findingsByPackage(findings);
  const projectSeverity = findingsByProject(findings);

  for (const node of federation.projects) {
    const project = node.project;
    const config = node.instance?.moduleFederation ?? project.moduleFederation;
    const projectId = projectNodeId(project, node.instanceId);
    addNode(
      nodes,
      withSeverity(
        {
          id: projectId,
          label: project.project.name,
          kind: "project" as const,
          project: project.project.name,
          ...(node.instanceId ? { meta: { federationInstanceId: node.instanceId } } : {}),
        },
        scopedSeverity(projectSeverity, project.project.name, node.instanceId),
      ),
    );
    for (const shared of Object.values(config?.shared ?? {})) {
      const id = sharedNodeId(shared.package, project.project.federationGroup, node.instanceId);
      const previous = nodes.get(id);
      const previousVersions = previous?.meta?.versions as Record<string, string> | undefined;
      const versions = previousVersions
        ? {
            ...previousVersions,
            [node.instanceId ? `${project.project.name}#${node.instanceId}` : project.project.name]:
              project.dependencies.installed[shared.package] ??
              String(shared.requiredVersion ?? shared.version ?? "*"),
          }
        : {
            [node.instanceId ? `${project.project.name}#${node.instanceId}` : project.project.name]:
              project.dependencies.installed[shared.package] ??
              String(shared.requiredVersion ?? shared.version ?? "*"),
          };
      addNode(
        nodes,
        withSeverity(
          {
            id,
            label: shared.package,
            kind: "shared" as const,
            meta: {
              singleton: shared.singleton,
              versions,
              ...(node.instanceId ? { federationInstanceId: node.instanceId } : {}),
            },
          },
          scopedSeverity(packageSeverity, shared.package, node.instanceId),
        ),
      );
      addEdge(
        edges,
        withSeverity(
          {
            id: `${projectId}->${id}`,
            source: projectId,
            target: id,
            label: shared.singleton ? "singleton" : "shared",
          },
          scopedSeverity(packageSeverity, shared.package, node.instanceId),
        ),
      );
    }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function buildOrchestrationGraph(findings: DoctorFinding[], federation: FederationModel): UiGraph {
  const nodes = new Map<string, UiGraphNode>();
  const edges = new Map<string, UiGraphEdge>();
  const projectSeverity = findingsByProject(findings);
  for (const node of federation.projects) {
    const project = node.project;
    const config = node.instance?.moduleFederation ?? project.moduleFederation;
    const scopedProjectId = projectNodeId(project, node.instanceId);
    addNode(
      nodes,
      withSeverity(
        {
          id: scopedProjectId,
          label: project.project.name,
          kind: "project" as const,
          project: project.project.name,
          meta: {
            externalRuntime: Boolean(config?.experiments?.externalRuntime),
            provideExternalRuntime: Boolean(config?.experiments?.provideExternalRuntime),
            ...(node.instanceId ? { federationInstanceId: node.instanceId } : {}),
          },
        },
        scopedSeverity(projectSeverity, project.project.name, node.instanceId),
      ),
    );

    for (const [key, filePath] of Object.entries(config?.exposes ?? {})) {
      const id = exposeNodeId(project, key, node.instanceId);
      addNode(nodes, {
        id,
        label: key,
        kind: "expose",
        project: project.project.name,
        meta: {
          path: filePath,
          ...(node.instanceId ? { federationInstanceId: node.instanceId } : {}),
        },
      });
      addEdge(edges, {
        id: `${scopedProjectId}->${id}`,
        source: scopedProjectId,
        target: id,
        label: "exposes",
      });
    }
  }

  const projectsById = new Map(federation.projects.map((node) => [node.id, node] as const));
  for (const edge of federation.remoteEdges) {
    const providerNode = edge.targetId ? projectsById.get(edge.targetId) : undefined;
    const sourceNode = projectsById.get(edge.fromId);
    if (!providerNode || !sourceNode) continue;
    const providerConfig =
      providerNode.instance?.moduleFederation ?? providerNode.project.moduleFederation;
    for (const key of Object.keys(providerConfig?.exposes ?? {})) {
      addEdge(edges, {
        id: `${projectNodeId(sourceNode.project, sourceNode.instanceId)}->${exposeNodeId(providerNode.project, key, providerNode.instanceId)}`,
        source: projectNodeId(sourceNode.project, sourceNode.instanceId),
        target: exposeNodeId(providerNode.project, key, providerNode.instanceId),
        label: `consumes ${edge.remoteName}`,
      });
    }
  }

  const nodesByGroup = new Map<string, typeof federation.projects>();
  for (const node of federation.projects) {
    const key = node.project.project.federationGroup ?? "\0ungrouped";
    nodesByGroup.set(key, [...(nodesByGroup.get(key) ?? []), node]);
  }
  for (const groupNodes of nodesByGroup.values()) {
    const group = groupNodes[0]?.federationGroup;
    const providers = groupNodes.filter(
      (node) =>
        (node.instance?.moduleFederation ?? node.project.moduleFederation)?.experiments
          ?.provideExternalRuntime,
    );
    const consumers = groupNodes.filter(
      (node) =>
        (node.instance?.moduleFederation ?? node.project.moduleFederation)?.experiments
          ?.externalRuntime,
    );
    if (providers.length === 0 && consumers.length === 0) continue;
    const runtimeId = runtimeNodeId(group);
    addNode(
      nodes,
      withSeverity(
        {
          id: runtimeId,
          label: "external runtime",
          kind: "runtime" as const,
          ...(group ? { meta: { federationGroup: group } } : {}),
        },
        findings.some((item) => item.ruleId.includes("external-runtime")) ? "error" : undefined,
      ),
    );
    for (const provider of providers)
      addEdge(edges, {
        id: `${projectNodeId(provider.project, provider.instanceId)}->${runtimeId}`,
        source: projectNodeId(provider.project, provider.instanceId),
        target: runtimeId,
        label: "provides",
      });
    for (const consumer of consumers)
      addEdge(edges, {
        id: `${runtimeId}->${projectNodeId(consumer.project, consumer.instanceId)}`,
        source: runtimeId,
        target: projectNodeId(consumer.project, consumer.instanceId),
        label: "consumes",
      });
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Build the programmatic federation graph payload (`DoctorUiPayload`).
 * This is not an HTML report — use it for custom visualizations or validators
 * against `schemas/ui.schema.json`. Supported CLI/plugin report surfaces remain
 * terminal, JSON, and SARIF only.
 */
export function buildUiPayload(projects: ProjectFacts[], report: DoctorReport): DoctorUiPayload {
  const findings = report.findings;
  const federation = buildFederationModel(projects);
  return {
    schemaVersion: 1,
    report,
    projects,
    graphs: {
      remotes: projects.length === 0 ? emptyGraph() : buildRemotesGraph(findings, federation),
      shared: projects.length === 0 ? emptyGraph() : buildSharedGraph(findings, federation),
      orchestration:
        projects.length === 0 ? emptyGraph() : buildOrchestrationGraph(findings, federation),
    },
  };
}

export function reportFromFindings(
  projects: ProjectFacts[],
  findings: DoctorFinding[],
): DoctorReport {
  const summary = summarizeFindings(findings);
  const health = computeHealthScore(findings);
  return {
    schemaVersion: 1,
    capabilities: {
      config: projects.some((project) => project.capabilities.config),
      sourceImports: projects.some((project) => project.capabilities.sourceImports),
      manifest: projects.some((project) => project.capabilities.manifest),
      stats: projects.some((project) => project.capabilities.stats),
      emittedAssets: projects.some((project) => project.capabilities.emittedAssets),
      installedVersions: projects.some((project) => project.capabilities.installedVersions),
    },
    summary: {
      projects: projects.length,
      info: summary.info,
      warnings: summary.warnings,
      errors: summary.errors,
      ...(summary.suppressed > 0 ? { suppressed: summary.suppressed } : {}),
      score: health.score,
      scoreLabel: health.scoreLabel,
    },
    findings,
  };
}
