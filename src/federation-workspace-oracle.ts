import semver from "semver";
import { buildFederationModel, findFederationCycleGroups } from "./federation-model.js";
import { FINDING_DETAILS_SCHEMAS } from "./finding-details.js";
import type {
  ArtifactFacts,
  ArtifactStats,
  BundlerName,
  FederationInstanceFacts,
  ProjectFacts,
} from "./types.js";
import { compareCodePoint } from "./utils.js";

export interface FederationOracleFinding {
  ruleId: string;
  project: string;
  message: string;
  evidence: Record<string, unknown>;
  detailsSchema?: string;
  details?: Record<string, unknown>;
}

export interface FederationWorkspaceOracleInput {
  projectGroup: readonly ProjectFacts[];
  groupEvidenceIncomplete: boolean;
  alwaysShared: ReadonlySet<string>;
}

/**
 * @module-federation/vite 1.22.0 started returning share `lib` synchronously once a
 * webpack-family container marked the share loaded. Non-singleton webpack shares can
 * be marked loaded without that `lib`, so a Vite remote's production `loadShare`
 * wrapper crashes (`RUNTIME-015`) on every reload after the first load.
 * Fixed in 1.23.4. Same version-gate pattern as `VITE_SSR_REMOTE_ENTRY_FIX` in src/rules.ts.
 * https://github.com/module-federation/vite/issues/1429
 */
const VITE_WEBPACK_NONSINGLETON_SHARE_INTRODUCED = "1.22.0";
const VITE_WEBPACK_NONSINGLETON_SHARE_FIX = "1.23.4";

function vitePluginVersionHasUnbridgedWebpackNonsingletonShare(
  pluginVersion: string | undefined,
): boolean {
  if (!pluginVersion) return false;
  const trimmed = pluginVersion.trim();
  const version = semver.valid(trimmed) ?? semver.coerce(trimmed)?.version;
  return (
    version !== undefined &&
    semver.major(version) === 1 &&
    semver.gte(version, VITE_WEBPACK_NONSINGLETON_SHARE_INTRODUCED) &&
    semver.lt(version, VITE_WEBPACK_NONSINGLETON_SHARE_FIX)
  );
}

/** Webpack-family bundlers whose containers can register unbridged non-singleton shares. */
function isWebpackFamilyBundler(
  name: BundlerName,
): name is "webpack" | "rspack" | "rsbuild" | "modern" {
  return name === "webpack" || name === "rspack" || name === "rsbuild" || name === "modern";
}

/**
 * Public `metaData.pluginVersion` on already-collected mf-stats JSON. Same field
 * collect.ts copies onto manifests; not a private MF plugin scrape.
 */
function pluginVersionFromStatsData(data: ArtifactStats["data"]): string | undefined {
  const metadata = data?.metaData;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const version = (metadata as Record<string, unknown>).pluginVersion;
  return typeof version === "string" ? version : undefined;
}

function addCollectedPluginVersions(target: Set<string>, artifacts: ArtifactFacts): void {
  const add = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) target.add(trimmed);
  };
  add(artifacts.manifest?.pluginVersion);
  add(pluginVersionFromStatsData(artifacts.stats?.data));
  for (const record of artifacts.records ?? []) {
    add(record.manifest?.pluginVersion);
    add(pluginVersionFromStatsData(record.stats?.data));
  }
}

function collectedPluginVersions(
  project: ProjectFacts,
  instance?: FederationInstanceFacts,
): string[] {
  const versions = new Set<string>();
  addCollectedPluginVersions(versions, instance?.artifacts ?? project.artifacts);
  return [...versions];
}

function affectedVitePluginVersion(versions: readonly string[]): string | undefined {
  return versions.find((version) => vitePluginVersionHasUnbridgedWebpackNonsingletonShare(version));
}

/** Workspace-level federation rule oracle shared by legacy V1 and evidence v2 evaluators. */
export function evaluateFederationWorkspaceOracle(
  input: FederationWorkspaceOracleInput,
): FederationOracleFinding[] {
  const findings: FederationOracleFinding[] = [];
  const { projectGroup, groupEvidenceIncomplete, alwaysShared } = input;
  const federation = buildFederationModel([...projectGroup]);
  const federationNodes = federation.projects;
  const nodeConfig = (node: (typeof federationNodes)[number]) =>
    node.instance?.moduleFederation ?? node.project.moduleFederation;
  const nodeScope = (node: (typeof federationNodes)[number]): string =>
    node.instanceId ? `${node.projectName}#${node.instanceId}` : node.projectName;

  for (const [name, owners] of federation.federationNames) {
    if (owners.length <= 1) continue;
    findings.push({
      ruleId: "federation/name-conflict",
      project: owners[0]?.projectName ?? "federation",
      message: `Module Federation name "${name}" is used by more than one federation scope.`,
      evidence: {
        name,
        projects: [...new Set(owners.map((owner) => owner.projectName))].sort(),
        instances: owners
          .map((owner) => {
            const instance = { project: owner.projectName } as {
              project: string;
              federationInstanceId?: string;
            };
            if (owner.instanceId) instance.federationInstanceId = owner.instanceId;
            return instance;
          })
          .sort((left, right) =>
            compareCodePoint(
              `${left.project}:${left.federationInstanceId ?? ""}`,
              `${right.project}:${right.federationInstanceId ?? ""}`,
            ),
          ),
      },
    });
  }

  const strategyOwners = new Map<string, string[]>();
  for (const node of federation.projects) {
    if (!nodeConfig(node)) continue;
    // Omitted is not version-first. Defaulting here would fake alignment across hosts.
    const strategy = node.shareStrategy ?? "omitted";
    strategyOwners.set(strategy, [...(strategyOwners.get(strategy) ?? []), nodeScope(node)]);
  }
  if (strategyOwners.size > 1) {
    findings.push({
      ruleId: "federation/share-strategy-mismatch",
      project: [...strategyOwners.values()][0]?.[0] ?? "federation",
      message: "Federation projects disagree on `shareStrategy`.",
      evidence: {
        strategies: Object.fromEntries(
          [...strategyOwners.entries()]
            .sort(([a], [b]) => compareCodePoint(a, b))
            .map(([strategy, owners]) => [strategy, [...owners].sort()]),
        ),
      },
    });
  }

  for (const cycle of findFederationCycleGroups(federation)) {
    if (cycle.riskEdges.length === 0) continue;
    const first = cycle.members[0];
    if (!first) continue;
    findings.push({
      ruleId: "federation/circular-remote-graph",
      project: first.projectName,
      message: `Remote graph has a cycle with eager \`version-first\` startup risk: ${cycle.members
        .map((member) => member.federationName ?? member.projectName)
        .join(" -> ")}.`,
      evidence: {
        projects: cycle.members.map((member) => member.projectName),
        members: cycle.members.map((member) => ({
          project: member.projectName,
          ...(member.instanceId ? { federationInstanceId: member.instanceId } : {}),
          federationName: member.federationName,
          ...(member.shareStrategy ? { shareStrategy: member.shareStrategy } : {}),
          asyncStartup: member.asyncStartup,
        })),
        edges: cycle.edges.map((edge) => ({
          from: edge.fromFederationName,
          to: edge.targetFederationName,
          project: edge.fromProject,
          ...(edge.fromInstanceId ? { fromInstanceId: edge.fromInstanceId } : {}),
          ...(edge.targetInstanceId ? { targetInstanceId: edge.targetInstanceId } : {}),
          remote: edge.remoteName,
          alias: edge.alias,
          entry: edge.entry,
        })),
        riskMembers: cycle.riskMembers.map((member) => {
          const riskMember = {
            project: member.projectName,
            federationName: member.federationName,
            asyncStartup: member.asyncStartup,
          } as {
            project: string;
            federationInstanceId?: string;
            federationName?: string;
            shareStrategy?: string;
            asyncStartup: boolean;
          };
          if (member.instanceId) riskMember.federationInstanceId = member.instanceId;
          if (member.shareStrategy) riskMember.shareStrategy = member.shareStrategy;
          return riskMember;
        }),
      },
    });
  }

  const externalRuntimeConsumers = federationNodes.filter(
    (node) => nodeConfig(node)?.experiments?.externalRuntime,
  );
  const runtimeProviders = federationNodes.filter(
    (node) => nodeConfig(node)?.experiments?.provideExternalRuntime,
  );
  if (
    !groupEvidenceIncomplete &&
    externalRuntimeConsumers.length > 0 &&
    runtimeProviders.length === 0
  ) {
    findings.push({
      ruleId: "federation/external-runtime-provider-missing",
      project: externalRuntimeConsumers[0]?.projectName ?? "federation",
      message: "Projects externalize the Module Federation runtime, but no project provides it.",
      evidence: {
        consumers: externalRuntimeConsumers.map(nodeScope).sort(),
      },
    });
  }

  const packages = new Set(
    federationNodes.flatMap((node) => Object.keys(nodeConfig(node)?.shared ?? {})),
  );
  for (const name of [...packages].sort()) {
    const entries = federationNodes
      .map((node) => ({ node, shared: nodeConfig(node)?.shared[name] }))
      .filter((entry) => entry.shared);
    const scopes = new Set(
      entries.map((entry) => JSON.stringify(entry.shared?.shareScope ?? ["default"])),
    );
    if (scopes.size > 1) {
      findings.push({
        ruleId: "federation/share-scope-mismatch",
        project: entries[0]?.node.projectName ?? "federation",
        message: `"${name}" uses different share scopes.`,
        evidence: {
          package: name,
          scopes: [...scopes].sort().map((scope) => JSON.parse(scope)),
          instances: entries.map((entry) => nodeScope(entry.node)).sort(),
        },
      });
    }
    const singleton = new Set(entries.map((entry) => entry.shared?.singleton));
    if (singleton.size > 1) {
      findings.push({
        ruleId: "shared/singleton-mismatch",
        project: entries[0]?.node.projectName ?? "federation",
        message: `"${name}" has inconsistent singleton settings.`,
        evidence: {
          package: name,
          instances: entries.map((entry) => nodeScope(entry.node)).sort(),
        },
        detailsSchema: FINDING_DETAILS_SCHEMAS.SHARED_SINGLETON,
        details: { package: name, kind: "mismatch" },
      });
    }
    const versions = entries
      .map((entry) => ({
        project: nodeScope(entry.node),
        ...(entry.node.instanceId ? { federationInstanceId: entry.node.instanceId } : {}),
        version: entry.node.project.dependencies.installed[name],
        range: entry.shared?.requiredVersion,
      }))
      .filter((entry) => entry.version);
    if (
      versions.some((left) =>
        versions.some(
          (right) =>
            left.version &&
            typeof right.range === "string" &&
            semver.valid(left.version) &&
            semver.validRange(right.range) &&
            !semver.satisfies(left.version, right.range),
        ),
      )
    ) {
      findings.push({
        ruleId: "federation/version-conflict",
        project: versions[0]?.project ?? "federation",
        message: `"${name}" versions do not satisfy all consumer ranges.`,
        evidence: { package: name, versions },
      });
    }
    const consumersWithoutFallback = entries.filter((entry) => entry.shared?.import === false);
    const providers = entries.filter((entry) => entry.shared?.import !== false);
    // Discriminate from reliability/shared-import-false:
    // - Provider present → never missing-provider (shared-import-false owns the advisory).
    // - Provider absent needs workspace proof. A lone import:false sharer without sibling
    //   use is the project-level advisory (provider may live outside this analysis set).
    if (!groupEvidenceIncomplete && consumersWithoutFallback.length > 0 && providers.length === 0) {
      const siblingUsesWithoutProviding = federationNodes.some((node) => {
        if (entries.some((entry) => entry.node === node)) return false;
        const imported = new Set([
          ...(node.project.imports?.packages ?? []),
          ...(node.project.imports?.dynamicPackages ?? []),
        ]);
        return imported.has(name);
      });
      const multipleImportFalseSharers = consumersWithoutFallback.length >= 2;
      if (multipleImportFalseSharers || siblingUsesWithoutProviding) {
        findings.push({
          ruleId: "federation/missing-provider",
          project: entries[0]?.node.projectName ?? "federation",
          message: `"${name}" has no provider or local fallback.`,
          evidence: {
            package: name,
            consumers: consumersWithoutFallback.map((entry) => nodeScope(entry.node)).sort(),
          },
        });
      }
    }
  }

  if (federationNodes.length > 1) {
    const sharedByPkg = new Map<string, Set<string>>();
    const usedByPkg = new Map<string, Set<string>>();
    for (const node of federationNodes) {
      const mfName = nodeScope(node);
      const config = nodeConfig(node);
      const imports = node.instance?.imports ?? node.project.imports;
      for (const pkg of Object.keys(config?.shared ?? {})) {
        if (!sharedByPkg.has(pkg)) sharedByPkg.set(pkg, new Set());
        sharedByPkg.get(pkg)!.add(mfName);
      }
      for (const pkg of imports?.packages ?? []) {
        if (!usedByPkg.has(pkg)) usedByPkg.set(pkg, new Set());
        usedByPkg.get(pkg)!.add(mfName);
      }
    }

    if (!groupEvidenceIncomplete) {
      for (const [pkg, usedByMfs] of [...usedByPkg.entries()].sort(([a], [b]) =>
        compareCodePoint(a, b),
      )) {
        if (usedByMfs.size < 2) continue;
        if (alwaysShared.has(pkg)) continue;
        const sharedByMfs = sharedByPkg.get(pkg);
        if (sharedByMfs && sharedByMfs.size > 0) continue;
        const isWorkspacePackage = projectGroup.some((project) => {
          const range = project.dependencies?.declared?.[pkg];
          return typeof range === "string" && range.startsWith("workspace:");
        });
        if (isWorkspacePackage) continue;
        findings.push({
          ruleId: "federation/host-gaps",
          project: [...usedByMfs].sort()[0] ?? "federation",
          message: `"${pkg}" is imported by ${usedByMfs.size} federation scopes but is not in any shared config.`,
          evidence: { package: pkg, missingIn: [...usedByMfs].sort() },
        });
      }
    }

    if (!groupEvidenceIncomplete) {
      for (const [pkg, sharedByMfs] of [...sharedByPkg.entries()].sort(([a], [b]) =>
        compareCodePoint(a, b),
      )) {
        if (alwaysShared.has(pkg)) continue;
        if (sharedByMfs.size !== 1) continue;
        const soloMf = [...sharedByMfs][0]!;
        const usedByMfs = usedByPkg.get(pkg) ?? new Set<string>();
        const usedUnsharedBy = [...usedByMfs]
          .filter((mf) => mf !== soloMf && !sharedByPkg.get(pkg)?.has(mf))
          .sort();
        const otherMfsUseIt = [...usedByMfs].some((mf) => mf !== soloMf);
        if (!otherMfsUseIt || usedUnsharedBy.length > 0) {
          findings.push({
            ruleId: "federation/ghost-shares",
            project: soloMf,
            message: otherMfsUseIt
              ? `"${pkg}" is shared only by "${soloMf}" while other projects import it without sharing.`
              : `"${pkg}" is shared only by "${soloMf}" and unused elsewhere in the federation graph.`,
            evidence: {
              package: pkg,
              sharedBy: soloMf,
              usedUnsharedBy,
            },
          });
        }
      }
    }
  }

  /**
   * Do not require a declared/installed version mismatch. Upstream #1429 / PR #1431
   * skip seeding when a webpack provider's *runtime share-scope* version differs;
   * public emit/config facts do not expose that comparison, so requiring it would
   * both false-negative same-declared-version crashes and pass-unknown when
   * versions are omitted. Non-singleton webpack-family overlap is the observable
   * trigger. Unknown plugin version or no webpack-family peer stays quiet.
   */
  for (const viteNode of federationNodes) {
    if (viteNode.project.bundler.name !== "vite") continue;
    const pluginVersion = affectedVitePluginVersion(
      collectedPluginVersions(viteNode.project, viteNode.instance),
    );
    if (!pluginVersion) continue;
    const viteShared = nodeConfig(viteNode)?.shared ?? {};
    const webpackPeers = federationNodes.filter(
      (peer) => peer !== viteNode && isWebpackFamilyBundler(peer.project.bundler.name),
    );
    if (webpackPeers.length === 0) continue;
    for (const pkg of Object.keys(viteShared).sort(compareCodePoint)) {
      const peers = webpackPeers.filter((peer) => {
        const shared = nodeConfig(peer)?.shared[pkg];
        return shared !== undefined && shared.singleton === false;
      });
      if (peers.length === 0) continue;
      findings.push({
        ruleId: "federation/vite-webpack-nonsingleton-share",
        project: viteNode.projectName,
        message: `"${pkg}" is shared as a non-singleton by a webpack-family peer; @module-federation/vite ${pluginVersion} can crash Vite remote loadShare (RUNTIME-015) until 1.23.4.`,
        evidence: {
          package: pkg,
          pluginVersion,
          viteInstance: nodeScope(viteNode),
          webpackPeers: peers.map(nodeScope).sort(compareCodePoint),
        },
      });
    }
  }

  return findings;
}
