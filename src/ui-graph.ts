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

function findingsByProject(findings: DoctorFinding[]): Map<string, Severity> {
  const map = new Map<string, Severity>();
  for (const finding of findings)
    map.set(finding.project, worstSeverity(map.get(finding.project), finding.severity));
  return map;
}

function findingsByPackage(findings: DoctorFinding[]): Map<string, Severity> {
  const map = new Map<string, Severity>();
  for (const finding of findings) {
    const packageName = finding.evidence.package;
    if (typeof packageName === "string")
      map.set(packageName, worstSeverity(map.get(packageName), finding.severity));
  }
  return map;
}

function encodedGroup(group: string | undefined): string | undefined {
  return group ? encodeURIComponent(group) : undefined;
}

function projectNodeId(project: ProjectFacts): string {
  const group = encodedGroup(project.project.federationGroup);
  return group
    ? `project:group:${group}:${project.project.name}`
    : `project:${project.project.name}`;
}

function remoteNodeId(consumer: string, remoteName: string, group?: string): string {
  const scope = encodedGroup(group);
  return scope
    ? `remote:group:${scope}:${consumer}:${remoteName}`
    : `remote:${consumer}:${remoteName}`;
}

function sharedNodeId(packageName: string, group?: string): string {
  const scope = encodedGroup(group);
  return scope ? `shared:group:${scope}:${packageName}` : `shared:${packageName}`;
}

function exposeNodeId(project: ProjectFacts, exposeKey: string): string {
  return `expose:${projectNodeId(project)}:${exposeKey}`;
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

function buildRemotesGraph(
  projects: ProjectFacts[],
  findings: DoctorFinding[],
  federation: FederationModel,
): UiGraph {
  const nodes = new Map<string, UiGraphNode>();
  const edges = new Map<string, UiGraphEdge>();
  const projectSeverity = findingsByProject(findings);
  for (const project of projects) {
    addNode(
      nodes,
      withSeverity(
        {
          id: projectNodeId(project),
          label: project.moduleFederation?.name
            ? `${project.project.name} (${project.moduleFederation.name})`
            : project.project.name,
          kind: "project" as const,
          project: project.project.name,
          meta: {
            bundler: project.bundler.name,
            exposes: Object.keys(project.moduleFederation?.exposes ?? {}).length,
            remotes: Object.keys(project.moduleFederation?.remotes ?? {}).length,
          },
        },
        projectSeverity.get(project.project.name),
      ),
    );
  }

  const projectsById = new Map(federation.projects.map((node) => [node.id, node] as const));
  for (const edge of federation.remoteEdges) {
    const sourceNode = projectsById.get(edge.fromId);
    const targetNode = edge.targetId ? projectsById.get(edge.targetId) : undefined;
    const targetId = targetNode
      ? projectNodeId(targetNode.project)
      : remoteNodeId(edge.fromProject, edge.remoteName, sourceNode?.federationGroup);
    if (!targetNode)
      addNode(nodes, {
        id: targetId,
        label: edge.remoteName,
        kind: "remote",
        meta: {
          entry: edge.entry,
          shareScope: edge.shareScope,
          alias: edge.alias,
        },
      });
    const source = sourceNode ? projectNodeId(sourceNode.project) : `project:${edge.fromProject}`;
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

function buildSharedGraph(projects: ProjectFacts[], findings: DoctorFinding[]): UiGraph {
  const nodes = new Map<string, UiGraphNode>();
  const edges = new Map<string, UiGraphEdge>();
  const packageSeverity = findingsByPackage(findings);
  const projectSeverity = findingsByProject(findings);

  for (const project of projects) {
    addNode(
      nodes,
      withSeverity(
        {
          id: projectNodeId(project),
          label: project.project.name,
          kind: "project" as const,
          project: project.project.name,
        },
        projectSeverity.get(project.project.name),
      ),
    );
    for (const shared of Object.values(project.moduleFederation?.shared ?? {})) {
      const id = sharedNodeId(shared.package, project.project.federationGroup);
      const previous = nodes.get(id);
      const previousVersions = previous?.meta?.versions as Record<string, string> | undefined;
      const versions = previousVersions
        ? {
            ...previousVersions,
            [project.project.name]:
              project.dependencies.installed[shared.package] ??
              String(shared.requiredVersion ?? shared.version ?? "*"),
          }
        : {
            [project.project.name]:
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
            meta: { singleton: shared.singleton, versions },
          },
          packageSeverity.get(shared.package),
        ),
      );
      addEdge(
        edges,
        withSeverity(
          {
            id: `${projectNodeId(project)}->${id}`,
            source: projectNodeId(project),
            target: id,
            label: shared.singleton ? "singleton" : "shared",
          },
          packageSeverity.get(shared.package),
        ),
      );
    }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function buildOrchestrationGraph(
  projects: ProjectFacts[],
  findings: DoctorFinding[],
  federation: FederationModel,
): UiGraph {
  const nodes = new Map<string, UiGraphNode>();
  const edges = new Map<string, UiGraphEdge>();
  const projectSeverity = findingsByProject(findings);
  for (const project of projects) {
    addNode(
      nodes,
      withSeverity(
        {
          id: projectNodeId(project),
          label: project.project.name,
          kind: "project" as const,
          project: project.project.name,
          meta: {
            externalRuntime: Boolean(project.moduleFederation?.experiments?.externalRuntime),
            provideExternalRuntime: Boolean(
              project.moduleFederation?.experiments?.provideExternalRuntime,
            ),
          },
        },
        projectSeverity.get(project.project.name),
      ),
    );

    for (const [key, filePath] of Object.entries(project.moduleFederation?.exposes ?? {})) {
      const id = exposeNodeId(project, key);
      addNode(nodes, {
        id,
        label: key,
        kind: "expose",
        project: project.project.name,
        meta: { path: filePath },
      });
      addEdge(edges, {
        id: `${projectNodeId(project)}->${id}`,
        source: projectNodeId(project),
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
    for (const key of Object.keys(providerNode.project.moduleFederation?.exposes ?? {})) {
      addEdge(edges, {
        id: `${projectNodeId(sourceNode.project)}->${exposeNodeId(providerNode.project, key)}`,
        source: projectNodeId(sourceNode.project),
        target: exposeNodeId(providerNode.project, key),
        label: `consumes ${edge.remoteName}`,
      });
    }
  }

  const projectsByGroup = new Map<string, ProjectFacts[]>();
  for (const project of projects) {
    const key = project.project.federationGroup ?? "\0ungrouped";
    projectsByGroup.set(key, [...(projectsByGroup.get(key) ?? []), project]);
  }
  for (const groupProjects of projectsByGroup.values()) {
    const group = groupProjects[0]?.project.federationGroup;
    const providers = groupProjects.filter(
      (project) => project.moduleFederation?.experiments?.provideExternalRuntime,
    );
    const consumers = groupProjects.filter(
      (project) => project.moduleFederation?.experiments?.externalRuntime,
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
        id: `${projectNodeId(provider)}->${runtimeId}`,
        source: projectNodeId(provider),
        target: runtimeId,
        label: "provides",
      });
    for (const consumer of consumers)
      addEdge(edges, {
        id: `${runtimeId}->${projectNodeId(consumer)}`,
        source: runtimeId,
        target: projectNodeId(consumer),
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
      remotes:
        projects.length === 0 ? emptyGraph() : buildRemotesGraph(projects, findings, federation),
      shared: projects.length === 0 ? emptyGraph() : buildSharedGraph(projects, findings),
      orchestration:
        projects.length === 0
          ? emptyGraph()
          : buildOrchestrationGraph(projects, findings, federation),
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
