import type { AnalysisBudgetTracker } from "./analysis-budgets.js";
import type {
  EvidenceGraphV2,
  EvidenceRuleEvaluation,
  EvidenceScope,
  EvidenceValue,
} from "./evidence.js";
import { migrateProjectFacts } from "./evidence-reader.js";
import {
  runEvidenceAwareRules,
  type EvidenceAwareRule,
  type EvidenceRuleRunnerOutput,
  type EvidenceRuleScope,
  type RuleEvaluationResult,
  type RuleExecutionState,
} from "./rule-contract.js";
import { ruleInventory } from "./rule-inventory.js";
import type { BuildRecord, DoctorFinding, ProjectFacts, RuleSetting, Severity } from "./types.js";
import { fingerprint, redact } from "./utils.js";

const NAME_REQUIRED_RULE_ID = "config/name-required";
const NAME_REQUIRED_V1_SUGGESTION = "Set `name`.";
const nameRequiredInventoryEntry = ruleInventory.find(
  (entry) => entry.id === NAME_REQUIRED_RULE_ID,
);
if (!nameRequiredInventoryEntry)
  throw new Error(`Missing evidence-aware inventory entry for ${NAME_REQUIRED_RULE_ID}`);

function isRecord(value: EvidenceValue | undefined): value is { [key: string]: EvidenceValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first built-in rollout slice. Keep this list intentionally small until parity gates pass. */
export const migratedEvidenceRules: readonly EvidenceAwareRule[] = [
  {
    meta: nameRequiredInventoryEntry,
    evaluate(context) {
      const config = context.evidence.find({
        predicate: "project.moduleFederation",
        layer: "declared",
        subjectKind: "project",
        minimumConfidence: "high",
        minimumCompleteness: "complete",
      })[0]?.value;
      if (!isRecord(config))
        throw new Error("Declared Module Federation config evidence is invalid.");
      const name = config.name;
      return typeof name === "string" && name.trim().length > 0
        ? { outcome: "pass" as const, reason: "Module Federation config has a non-empty name." }
        : { outcome: "fail" as const, reason: "Module Federation config needs a non-empty name." };
    },
  },
];

export const migratedEvidenceRuleIds: ReadonlySet<string> = new Set(
  migratedEvidenceRules.map((rule) => rule.meta.id),
);

function projectRole(facts: ProjectFacts): string {
  const config = facts.moduleFederation;
  if (!config) return "unknown";
  const hasRemotes = Object.keys(config.remotes ?? {}).length > 0;
  const hasExposes = Object.keys(config.exposes ?? {}).length > 0;
  if (hasRemotes && hasExposes) return "host+remote";
  if (hasRemotes) return "host";
  if (hasExposes) return "remote";
  return "unknown";
}

/** Derive evaluation scope from facts already collected by the normal analyzer. */
export function evidenceRuleScopeFor(
  facts: ProjectFacts,
  selectedBuild?: BuildRecord,
): EvidenceRuleScope {
  const build = selectedBuild ?? (facts.builds?.length === 1 ? facts.builds[0] : undefined);
  const adapter = facts.canonicalConfig?.contract.adapter;
  const bundler = facts.canonicalConfig?.contract.bundler;
  const adapterVersion = adapter?.version ?? facts.bundler.version;
  const bundlerVersion = bundler?.version ?? facts.bundler.version;
  return {
    adapter: adapter?.name ?? facts.bundler.name,
    ...(adapterVersion ? { adapterVersion } : {}),
    bundler: {
      name: bundler?.name ?? facts.bundler.name,
      ...(bundlerVersion ? { version: bundlerVersion } : {}),
    },
    target: build?.target ?? build?.targetKind ?? "unknown",
    ...(build?.effectiveMode ? { buildMode: build.effectiveMode } : {}),
    projectRole: projectRole(facts),
    ...(build
      ? {
          buildId: build.id,
          ...(build.compilationName ? { compilationId: build.compilationName } : {}),
        }
      : {}),
    ...(facts.federationInstanceId ? { federationInstanceId: facts.federationInstanceId } : {}),
  };
}

function artifactsForBuild(
  existing: ProjectFacts["artifacts"],
  build: BuildRecord,
): ProjectFacts["artifacts"] {
  const artifacts = structuredClone(existing);
  delete artifacts.manifest;
  delete artifacts.stats;
  artifacts.emittedAssets = build.emittedAssets.slice();
  artifacts.records = structuredClone(build.artifacts);
  const manifest = build.artifacts.find((record) => record.kind === "manifest")?.manifest;
  const stats = build.artifacts.find((record) => record.kind === "stats")?.stats;
  if (manifest) artifacts.manifest = structuredClone(manifest);
  if (stats) artifacts.stats = structuredClone(stats);
  if (artifacts.assetSizes) {
    const selectedAssets = new Set(build.emittedAssets);
    artifacts.assetSizes = Object.fromEntries(
      Object.entries(artifacts.assetSizes).filter(([asset]) => selectedAssets.has(asset)),
    );
    if (Object.keys(artifacts.assetSizes).length === 0) delete artifacts.assetSizes;
  }
  return artifacts;
}

function emptyScopedArtifacts(existing: ProjectFacts["artifacts"]): ProjectFacts["artifacts"] {
  const artifacts = structuredClone(existing);
  delete artifacts.manifest;
  delete artifacts.stats;
  delete artifacts.assetSizes;
  artifacts.emittedAssets = [];
  artifacts.records = [];
  return artifacts;
}

/** Keep every migrated graph strictly inside the selected build/instance scope. */
function factsForBuild(facts: ProjectFacts, build: BuildRecord): ProjectFacts {
  const scoped = structuredClone(facts);
  scoped.builds = [structuredClone(build)];
  scoped.artifacts = artifactsForBuild(scoped.artifacts, build);
  scoped.capabilities = {
    ...scoped.capabilities,
    emittedAssets: build.capabilities.emittedAssets.state === "exact",
    manifest: scoped.artifacts.manifest !== undefined,
    stats: scoped.artifacts.stats !== undefined,
  };
  if (scoped.federationInstances) {
    const instanceIds = scoped.federationInstanceId
      ? new Set([scoped.federationInstanceId])
      : new Set(build.federationInstanceIds ?? []);
    scoped.federationInstances = scoped.federationInstances
      .filter((instance) => instanceIds.has(instance.id))
      .map((instance) => {
        const instanceBuild = instance.builds?.find((candidate) => candidate.id === build.id);
        return Object.assign({}, instance, {
          builds: instanceBuild ? [structuredClone(instanceBuild)] : [],
          artifacts: instanceBuild
            ? artifactsForBuild(instance.artifacts, instanceBuild)
            : emptyScopedArtifacts(instance.artifacts),
          capabilities: Object.assign({}, instance.capabilities, {
            emittedAssets: instanceBuild
              ? instanceBuild.capabilities.emittedAssets.state === "exact"
              : false,
            manifest: instanceBuild
              ? instanceBuild.artifacts.some((record) => record.kind === "manifest")
              : false,
            stats: instanceBuild
              ? instanceBuild.artifacts.some((record) => record.kind === "stats")
              : false,
          }),
        });
      });
  }
  return scoped;
}

const GRAPH_TARGETS = new Set<EvidenceScope["target"]>([
  "web",
  "node",
  "browser",
  "ssr",
  "unknown",
]);

function graphScopeFor(graphScope: EvidenceScope, scope: EvidenceRuleScope): EvidenceScope {
  const target = GRAPH_TARGETS.has(scope.target as EvidenceScope["target"])
    ? (scope.target as EvidenceScope["target"])
    : graphScope.target;
  return {
    ...graphScope,
    ...(scope.adapter ? { adapter: scope.adapter } : {}),
    ...(scope.adapterVersion ? { adapterVersion: scope.adapterVersion } : {}),
    bundler: {
      ...graphScope.bundler,
      ...scope.bundler,
    },
    target,
    ...(scope.buildMode ? { buildMode: scope.buildMode } : {}),
    ...(scope.projectRole ? { projectRole: scope.projectRole } : {}),
    ...(scope.buildId ? { buildId: scope.buildId } : {}),
    ...(scope.compilationId ? { compilationId: scope.compilationId } : {}),
    ...(scope.federationInstanceId ? { federationInstanceId: scope.federationInstanceId } : {}),
  };
}

function applyGraphScope(graph: EvidenceGraphV2, scope: EvidenceRuleScope): EvidenceScope {
  const graphScope = graphScopeFor(graph.scope, scope);
  graph.scope = graphScope;
  graph.identity = {
    ...graph.identity,
    ...(scope.buildId ? { buildId: scope.buildId } : {}),
    ...(scope.compilationId ? { compilationId: scope.compilationId } : {}),
    ...(scope.federationInstanceId ? { federationInstanceId: scope.federationInstanceId } : {}),
  };
  graph.assertions = graph.assertions.map((assertion) => ({
    ...assertion,
    scope: { ...graphScope, bundler: { ...graphScope.bundler } },
  }));
  return graphScope;
}

function graphEvaluationFor(
  evaluation: RuleEvaluationResult,
  graphScope: EvidenceScope,
): EvidenceRuleEvaluation {
  const result: EvidenceRuleEvaluation = {
    id: evaluation.id,
    rule: evaluation.rule,
    subject: evaluation.subject,
    outcome: evaluation.outcome,
    evidenceIds: evaluation.evidenceIds.slice(),
    reason: evaluation.reason,
    reasonCode: evaluation.reasonCode,
    confidence: evaluation.confidence,
    scope: graphScopeFor(graphScope, evaluation.scope),
    completeness: {
      status: evaluation.completeness,
      reason: evaluation.reason,
    },
  };
  if ("missingRequirements" in evaluation)
    result.missingRequirements = evaluation.missingRequirements as unknown as EvidenceValue[];
  return result;
}

function factsForEvidence(facts: ProjectFacts): ProjectFacts {
  const copy = structuredClone(facts);
  // These are in-memory additive bridges and are intentionally absent from the
  // persisted v1 project schema consumed by migrateProjectFacts.
  delete copy.canonicalConfig;
  delete copy.artifacts.records;
  if (copy.federationInstances) {
    const instances = copy.federationInstanceId
      ? copy.federationInstances.filter((instance) => instance.id === copy.federationInstanceId)
      : copy.federationInstances;
    copy.federationInstances = instances.map((instance) => {
      delete instance.canonicalConfig;
      delete instance.artifacts.records;
      return instance;
    });
  }
  return copy;
}

export interface MigratedEvidenceRun {
  graph: EvidenceGraphV2;
  output: EvidenceRuleRunnerOutput;
}

/** Build the v2 view from collected facts and run only the migrated slice. */
export async function runMigratedEvidenceRules(
  facts: ProjectFacts,
  settings: Readonly<Record<string, RuleSetting>>,
  analysisBudget?: AnalysisBudgetTracker,
  selectedBuild?: BuildRecord,
): Promise<MigratedEvidenceRun> {
  const scopedFacts = selectedBuild ? factsForBuild(facts, selectedBuild) : facts;
  const graph = migrateProjectFacts(
    factsForEvidence(scopedFacts),
    analysisBudget ? { analysisBudget } : {},
  );
  const scope = evidenceRuleScopeFor(scopedFacts, selectedBuild);
  const graphScope = applyGraphScope(graph, scope);
  const rules = migratedEvidenceRules.filter((rule) => settings[rule.meta.id] !== "off");
  const disabled: RuleExecutionState[] = migratedEvidenceRules
    .filter((rule) => settings[rule.meta.id] === "off")
    .map((rule) => ({
      state: "disabled" as const,
      rule: { id: rule.meta.id, version: rule.meta.version },
      reason: 'Rule is disabled by configuration (setting is "off").',
    }));
  const output = await runEvidenceAwareRules({
    graph,
    rules,
    scope,
    ...(analysisBudget ? { analysisBudget } : {}),
  });
  graph.evaluations = output.evaluations
    .map((evaluation) => graphEvaluationFor(evaluation, graphScope))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { graph, output: { ...output, execution: [...disabled, ...output.execution] } };
}

function severityFor(setting: RuleSetting | undefined, fallback: Severity): Severity | undefined {
  if (setting === "off") return undefined;
  if (setting && typeof setting !== "string") return setting[0];
  return setting ?? fallback;
}

/** Project only conclusive v2 failures into the existing V1 finding shape. */
export function projectMigratedFailures(
  evaluations: readonly RuleEvaluationResult[],
  facts: ProjectFacts,
  settings: Readonly<Record<string, RuleSetting>>,
  root: string,
): DoctorFinding[] {
  const rules = new Map(migratedEvidenceRules.map((rule) => [rule.meta.id, rule]));
  const findings: DoctorFinding[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.outcome !== "fail") continue;
    const rule = rules.get(evaluation.rule.id);
    if (!rule) continue;
    const severity = severityFor(settings[evaluation.rule.id], rule.meta.defaultSeverity);
    if (!severity) continue;
    const base = {
      schemaVersion: 1 as const,
      ruleId: evaluation.rule.id,
      severity,
      message: redact(evaluation.reason, root) as string,
      project: facts.project.name,
      ...(facts.federationInstanceId ? { federationInstanceId: facts.federationInstanceId } : {}),
      evidence: {} as Record<string, unknown>,
      documentation: rule.meta.remediation.documentation,
      ...(rule.meta.id === NAME_REQUIRED_RULE_ID
        ? { suggestion: redact(NAME_REQUIRED_V1_SUGGESTION, root) as string }
        : rule.meta.remediation.fix
          ? { suggestion: redact(rule.meta.remediation.fix, root) as string }
          : {}),
    };
    findings.push({ ...base, fingerprint: fingerprint(base) });
  }
  return findings;
}
