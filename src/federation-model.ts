import type { ProjectFacts } from "./types.js";

export interface FederationDtsFacts {
  enabled: boolean;
  extractRemoteTypes: boolean;
  outputDir?: string;
  remoteTypeUrls: boolean;
  typesFolder?: string;
  emittedTypeAssets: string[];
}

export interface FederationProjectNode {
  id: string;
  project: ProjectFacts;
  projectName: string;
  federationName?: string;
  shareStrategy: "version-first" | "loaded-first";
  asyncStartup: boolean;
  exposes: string[];
  remotes: FederationRemoteEdge[];
  dts: FederationDtsFacts;
}

export interface FederationRemoteEdge {
  id: string;
  fromId: string;
  fromProject: string;
  fromFederationName: string;
  alias: string;
  remoteName: string;
  entry: string;
  shareScope: string | string[];
  targetId?: string;
  targetProject?: string;
  targetFederationName?: string;
  matched: boolean;
}

export interface FederationModel {
  projects: FederationProjectNode[];
  federationNames: Map<string, FederationProjectNode[]>;
  remoteEdges: FederationRemoteEdge[];
  unmatchedRemotes: FederationRemoteEdge[];
}

export interface FederationCycleGroup {
  members: FederationProjectNode[];
  edges: FederationRemoteEdge[];
  riskMembers: FederationProjectNode[];
  riskEdges: FederationRemoteEdge[];
}

function dtsFacts(project: ProjectFacts): FederationDtsFacts {
  const config = project.moduleFederation;
  const dtsOptions = config?.dts?.options ?? {};
  const generateTypes: Record<string, unknown> =
    dtsOptions.generateTypes && typeof dtsOptions.generateTypes === "object"
      ? (dtsOptions.generateTypes as Record<string, unknown>)
      : dtsOptions;
  const consumeTypes: Record<string, unknown> =
    dtsOptions.consumeTypes && typeof dtsOptions.consumeTypes === "object"
      ? (dtsOptions.consumeTypes as Record<string, unknown>)
      : dtsOptions;
  const emittedTypeAssets = project.artifacts.emittedAssets
    .filter((asset) => /(?:\.d\.(?:ts|mts)|@mf-types\.zip)$/.test(asset))
    .sort();
  return {
    enabled: config?.dts?.enabled ?? false,
    extractRemoteTypes: generateTypes.extractRemoteTypes === true,
    ...(typeof generateTypes.outputDir === "string" ? { outputDir: generateTypes.outputDir } : {}),
    remoteTypeUrls: consumeTypes.remoteTypeUrls !== undefined,
    ...(typeof generateTypes.typesFolder === "string"
      ? { typesFolder: generateTypes.typesFolder }
      : {}),
    emittedTypeAssets,
  };
}

function projectId(project: ProjectFacts): string {
  return (
    project.project.identityKey ?? `${project.moduleFederation?.name ?? ""}:${project.project.name}`
  );
}

function sortNodes(nodes: FederationProjectNode[]): FederationProjectNode[] {
  return nodes.sort(
    (left, right) =>
      left.projectName.localeCompare(right.projectName) || left.id.localeCompare(right.id),
  );
}

/** Build the one shared owner of federation names, projects, remotes, and DTS facts. */
export function buildFederationModel(projects: ProjectFacts[]): FederationModel {
  const nodes = sortNodes(
    projects.map((project) => ({
      id: projectId(project),
      project,
      projectName: project.project.name,
      ...(project.moduleFederation?.name ? { federationName: project.moduleFederation.name } : {}),
      shareStrategy: project.moduleFederation?.shareStrategy ?? "version-first",
      asyncStartup: project.moduleFederation?.experiments?.asyncStartup ?? false,
      exposes: Object.keys(project.moduleFederation?.exposes ?? {}).sort(),
      remotes: [],
      dts: dtsFacts(project),
    })),
  );
  const federationNames = new Map<string, FederationProjectNode[]>();
  for (const node of nodes) {
    if (!node.federationName) continue;
    const owners = federationNames.get(node.federationName) ?? [];
    owners.push(node);
    federationNames.set(node.federationName, owners);
  }
  for (const owners of federationNames.values()) sortNodes(owners);

  const remoteEdges: FederationRemoteEdge[] = [];
  for (const node of nodes) {
    if (!node.federationName) continue;
    const remotes = Object.entries(node.project.moduleFederation?.remotes ?? {}).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    for (const [alias, remote] of remotes) {
      const owners = federationNames.get(remote.name) ?? [];
      const target = owners.length === 1 ? owners[0] : undefined;
      const edge: FederationRemoteEdge = {
        id: `${node.id}->${target?.id ?? `remote:${remote.name}`}:${alias}`,
        fromId: node.id,
        fromProject: node.projectName,
        fromFederationName: node.federationName,
        alias,
        remoteName: remote.name,
        entry: remote.entry,
        shareScope: remote.shareScope,
        ...(target
          ? {
              targetId: target.id,
              targetProject: target.projectName,
              targetFederationName: target.federationName,
            }
          : {}),
        matched: Boolean(target),
      };
      remoteEdges.push(edge);
    }
  }
  remoteEdges.sort((left, right) => left.id.localeCompare(right.id));
  for (const node of nodes) node.remotes = remoteEdges.filter((edge) => edge.fromId === node.id);

  return {
    projects: nodes,
    federationNames,
    remoteEdges,
    unmatchedRemotes: remoteEdges.filter((edge) => !edge.matched),
  };
}

/** Find cyclic groups with Tarjan's SCC algorithm. Output is stable by project id. */
export function findFederationCycleGroups(model: FederationModel): FederationCycleGroup[] {
  const nodes = model.projects.filter((node) => node.federationName);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(
      node.id,
      model.remoteEdges
        .filter((edge) => edge.fromId === node.id && edge.targetId && byId.has(edge.targetId))
        .map((edge) => edge.targetId!)
        .sort(),
    );
  }

  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string): void => {
    indexes.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indexes.get(target)!));
      }
    }
    if (lowLinks.get(id) !== indexes.get(id)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort());
  };
  for (const node of [...nodes].sort((left, right) => left.id.localeCompare(right.id)))
    if (!indexes.has(node.id)) visit(node.id);

  return components
    .filter((component) => {
      if (component.length > 1) return true;
      return (adjacency.get(component[0]!) ?? []).includes(component[0]!);
    })
    .sort((left, right) => left.join("\0").localeCompare(right.join("\0")))
    .map((component) => {
      const memberIds = new Set(component);
      const members = component.map((id) => byId.get(id)!);
      const edges = model.remoteEdges
        .filter(
          (edge) =>
            memberIds.has(edge.fromId) &&
            edge.targetId !== undefined &&
            memberIds.has(edge.targetId),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      const riskMembers = members.filter((member) => member.shareStrategy === "version-first");
      const riskMemberIds = new Set(riskMembers.map((member) => member.id));
      const riskEdges = edges.filter((edge) => riskMemberIds.has(edge.fromId));
      return { members, edges, riskMembers, riskEdges };
    });
}
