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

function projectNodeId(project: ProjectFacts): string {
  return `project:${project.project.name}`;
}

function remoteNodeId(consumer: string, remoteName: string): string {
  return `remote:${consumer}:${remoteName}`;
}

function sharedNodeId(packageName: string): string {
  return `shared:${packageName}`;
}

function exposeNodeId(project: string, exposeKey: string): string {
  return `expose:${project}:${exposeKey}`;
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

function buildRemotesGraph(projects: ProjectFacts[], findings: DoctorFinding[]): UiGraph {
  const nodes = new Map<string, UiGraphNode>();
  const edges = new Map<string, UiGraphEdge>();
  const projectSeverity = findingsByProject(findings);
  const federationNames = new Map<string, string>();

  for (const project of projects) {
    const name = project.moduleFederation?.name;
    if (name) federationNames.set(name, project.project.name);
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

  for (const project of projects) {
    const remotes = project.moduleFederation?.remotes ?? {};
    for (const remote of Object.values(remotes)) {
      const matchedName = federationNames.get(remote.name);
      const matched = matchedName
        ? projects.find((item) => item.project.name === matchedName)
        : undefined;
      const targetId = matched
        ? projectNodeId(matched)
        : remoteNodeId(project.project.name, remote.name);
      if (!matched)
        addNode(nodes, {
          id: targetId,
          label: remote.name,
          kind: "remote",
          meta: {
            entry: remote.entry,
            shareScope: remote.shareScope,
            alias: remote.alias,
          },
        });
      addEdge(edges, {
        id: `${projectNodeId(project)}->${targetId}`,
        source: projectNodeId(project),
        target: targetId,
        label: remote.alias ?? remote.name,
      });
    }
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
      const id = sharedNodeId(shared.package);
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

function buildOrchestrationGraph(projects: ProjectFacts[], findings: DoctorFinding[]): UiGraph {
  const nodes = new Map<string, UiGraphNode>();
  const edges = new Map<string, UiGraphEdge>();
  const projectSeverity = findingsByProject(findings);
  const federationNames = new Map<string, ProjectFacts>();

  for (const project of projects) {
    const name = project.moduleFederation?.name;
    if (name) federationNames.set(name, project);
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
      const id = exposeNodeId(project.project.name, key);
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

  for (const project of projects) {
    for (const remote of Object.values(project.moduleFederation?.remotes ?? {})) {
      const provider = federationNames.get(remote.name);
      if (!provider) continue;
      for (const key of Object.keys(provider.moduleFederation?.exposes ?? {})) {
        addEdge(edges, {
          id: `${projectNodeId(project)}->${exposeNodeId(provider.project.name, key)}`,
          source: projectNodeId(project),
          target: exposeNodeId(provider.project.name, key),
          label: `consumes ${remote.name}`,
        });
      }
    }
  }

  const providers = projects.filter(
    (project) => project.moduleFederation?.experiments?.provideExternalRuntime,
  );
  const consumers = projects.filter(
    (project) => project.moduleFederation?.experiments?.externalRuntime,
  );
  if (providers.length > 0 || consumers.length > 0) {
    const runtimeId = "runtime:external";
    addNode(
      nodes,
      withSeverity(
        {
          id: runtimeId,
          label: "external runtime",
          kind: "runtime" as const,
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

export function buildUiPayload(projects: ProjectFacts[], report: DoctorReport): DoctorUiPayload {
  const findings = report.findings;
  return {
    schemaVersion: 1,
    report,
    projects,
    graphs: {
      remotes: projects.length === 0 ? emptyGraph() : buildRemotesGraph(projects, findings),
      shared: projects.length === 0 ? emptyGraph() : buildSharedGraph(projects, findings),
      orchestration:
        projects.length === 0 ? emptyGraph() : buildOrchestrationGraph(projects, findings),
    },
  };
}

export function reportFromFindings(
  projects: ProjectFacts[],
  findings: DoctorFinding[],
): DoctorReport {
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
      info: findings.filter((item) => item.severity === "info").length,
      warnings: findings.filter((item) => item.severity === "warning").length,
      errors: findings.filter((item) => item.severity === "error").length,
    },
    findings,
  };
}
