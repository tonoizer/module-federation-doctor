import semver from "semver";
import { buildFederationModel, findFederationCycleGroups } from "./federation-model.js";
import { FINDING_DETAILS_SCHEMAS } from "./finding-details.js";
import type { ProjectFacts } from "./types.js";
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
    strategyOwners.set(node.shareStrategy, [
      ...(strategyOwners.get(node.shareStrategy) ?? []),
      nodeScope(node),
    ]);
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
          shareStrategy: member.shareStrategy,
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
            shareStrategy: member.shareStrategy,
            asyncStartup: member.asyncStartup,
          } as {
            project: string;
            federationInstanceId?: string;
            federationName?: string;
            shareStrategy: string;
            asyncStartup: boolean;
          };
          if (member.instanceId) riskMember.federationInstanceId = member.instanceId;
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
    if (!groupEvidenceIncomplete && consumersWithoutFallback.length > 0 && providers.length === 0) {
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

  return findings;
}
