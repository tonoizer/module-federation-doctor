import type { AnalysisBudgetTracker } from "./analysis-budgets.js";
import type {
  EvidenceGraphV2,
  EvidenceRuleEvaluation,
  EvidenceScope,
  EvidenceSubject,
  EvidenceValue,
} from "./evidence.js";
import { migrateProjectFacts } from "./evidence-reader.js";
import { builtInRules } from "./rules.js";
import {
  MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS,
  MIGRATED_GROUP1_CONFIG_RULE_IDS,
  MIGRATED_GROUP2_RULE_IDS,
  MIGRATED_GROUP3_RULE_IDS,
  MIGRATED_GROUP5_RULE_IDS,
  MIGRATED_GROUP6_RULE_IDS,
  ruleInventory,
} from "./rule-inventory.js";
import {
  runEvidenceAwareRules,
  type EvidenceAwareRule,
  type EvidenceRuleContext,
  type EvidenceRuleFinding,
  type EvidenceRuleRunnerOutput,
  type EvidenceRuleScope,
  type RuleEvaluationResult,
  type RuleExecutionState,
} from "./rule-contract.js";
import type {
  BuildRecord,
  DoctorFinding,
  ProjectFacts,
  RuleContext,
  RuleSetting,
  RuntimeTraceReport,
  Severity,
} from "./types.js";
import { shouldSkipMf2SharedUnused } from "./mf-toolkit-shapes.js";
import { fingerprint, redact } from "./utils.js";
import {
  attachRuntimeTraceEvidence,
  classifyRuntimeAttribution,
  correlateRuntime,
  tracesForSubject,
} from "./runtime-trace.js";

type LegacyFindingInput = Omit<
  DoctorFinding,
  "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint"
>;

export type MigratedEvidenceRuleId =
  | (typeof MIGRATED_GROUP1_CONFIG_RULE_IDS)[number]
  | (typeof MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS)[number]
  | (typeof MIGRATED_GROUP2_RULE_IDS)[number]
  | (typeof MIGRATED_GROUP3_RULE_IDS)[number]
  | (typeof MIGRATED_GROUP5_RULE_IDS)[number]
  | (typeof MIGRATED_GROUP6_RULE_IDS)[number];

export type MigratedRuntimeEvidenceRuleId = (typeof MIGRATED_GROUP5_RULE_IDS)[number];

const MIGRATED_STATIC_EVIDENCE_RULE_IDS = [
  ...MIGRATED_GROUP1_CONFIG_RULE_IDS,
  ...MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS,
  ...MIGRATED_GROUP2_RULE_IDS,
  ...MIGRATED_GROUP3_RULE_IDS,
  ...MIGRATED_GROUP6_RULE_IDS,
] as const;

function inventoryEntry(id: string) {
  const entry = ruleInventory.find((item) => item.id === id);
  if (!entry) throw new Error(`Missing evidence-aware inventory entry for ${id}`);
  return entry;
}

function toEvidenceValue(value: unknown): EvidenceValue {
  return value as EvidenceValue;
}

function toEvidenceFinding(value: LegacyFindingInput): EvidenceRuleFinding {
  return {
    message: value.message,
    evidence: Object.fromEntries(
      Object.entries(value.evidence ?? {}).map(([key, item]) => [key, toEvidenceValue(item)]),
    ),
    ...(value.suggestion ? { suggestion: value.suggestion } : {}),
    ...(value.location ? { location: value.location } : {}),
    ...(value.detailsSchema ? { detailsSchema: value.detailsSchema } : {}),
    ...(value.details
      ? { details: toEvidenceValue(value.details) as Record<string, EvidenceValue> }
      : {}),
  };
}

function legacyRuleContext(context: EvidenceRuleContext): Omit<RuleContext, "report"> {
  if (!context.facts) throw new Error("Project facts are missing for migrated rule evaluation.");
  const base = structuredClone(context.facts);
  const facts: ProjectFacts = context.scope.buildMode
    ? {
        ...base,
        bundler: {
          ...base.bundler,
          mode: context.scope.buildMode as ProjectFacts["bundler"]["mode"],
        },
      }
    : base;
  return {
    facts,
    options: structuredClone(context.options),
    ...(context.root ? { root: context.root } : {}),
    ...(context.sharedPolicy
      ? {
          sharedPolicy: context.sharedPolicy as NonNullable<RuleContext["sharedPolicy"]>,
        }
      : {}),
    ...(context.recognizeMfToolkit !== undefined
      ? { recognizeMfToolkit: context.recognizeMfToolkit }
      : {}),
  };
}

function sharedUnusedEvidenceInconclusive(context: EvidenceRuleContext): string | undefined {
  if (!context.facts) return undefined;
  const unresolvedMayHideUsage = (context.facts.imports.unresolvedDynamic ?? []).some((item) =>
    ["import", "loadShare", "loadShareSync"].includes(item.api),
  );
  if (unresolvedMayHideUsage)
    return "Unresolved dynamic import or loadShare evidence cannot establish unused certainty.";
  if (
    shouldSkipMf2SharedUnused({
      ...legacyRuleContext(context),
      report: () => {},
    })
  )
    return "MF2 shared-array manifest-only evidence cannot establish unused certainty.";
  return undefined;
}

function pluginPackageMismatchEvidenceInconclusive(
  context: EvidenceRuleContext,
): string | undefined {
  if (!context.facts) return undefined;
  if (
    context.facts.bundler.name === "webpack" &&
    context.facts.bundler.moduleFederationPluginCount === undefined
  )
    return "Webpack plugin registration count was not collected; package metadata alone cannot judge the integration.";
  return undefined;
}

function vitePluginConfigEvidenceInconclusive(context: EvidenceRuleContext): string | undefined {
  if (!context.facts || context.facts.bundler.name !== "vite") return undefined;
  if (!context.facts.bundler.viteConfig)
    return "Plugin-observed Vite config facts were not collected for this analysis.";
  return undefined;
}

function viteServerOriginEvidenceInconclusive(context: EvidenceRuleContext): string | undefined {
  const missing = vitePluginConfigEvidenceInconclusive(context);
  if (missing) return missing;
  const viteConfig = context.facts!.bundler.viteConfig;
  if (!viteConfig || !("serverOrigin" in viteConfig))
    return "server.origin was not observed by the Vite plugin for this analysis.";
  return undefined;
}

function transformImportEvidenceInconclusive(context: EvidenceRuleContext): string | undefined {
  if (!context.facts) return undefined;
  if (context.facts.bundler.transformImportLibraries === undefined)
    return "transformImport library facts were not collected for this analysis.";
  return undefined;
}

const GROUP6_INCONCLUSIVE: Partial<
  Record<
    (typeof MIGRATED_GROUP6_RULE_IDS)[number],
    (context: EvidenceRuleContext) => string | undefined
  >
> = {
  "vite/manual-chunks-conflict": vitePluginConfigEvidenceInconclusive,
  "vite/alias-share-bypass": vitePluginConfigEvidenceInconclusive,
  "vite/server-origin": viteServerOriginEvidenceInconclusive,
  "config/transform-import-share-conflict": transformImportEvidenceInconclusive,
};

function inconclusiveFor(
  id: (typeof MIGRATED_STATIC_EVIDENCE_RULE_IDS)[number],
): ((context: EvidenceRuleContext) => string | undefined) | undefined {
  if (id === "shared/unused") return sharedUnusedEvidenceInconclusive;
  if (id === "config/plugin-package-mismatch") return pluginPackageMismatchEvidenceInconclusive;
  return GROUP6_INCONCLUSIVE[id as (typeof MIGRATED_GROUP6_RULE_IDS)[number]];
}

/**
 * Run the existing V1 check behind the evidence contract. The common runner
 * owns applicability, prerequisites, confidence, unknown results, identities,
 * and execution metadata; the check remains the compatibility oracle until
 * the rule gets a dedicated evidence-native evaluator in a later slice.
 */
function legacyEvidenceRule(
  id: (typeof MIGRATED_STATIC_EVIDENCE_RULE_IDS)[number],
  inconclusive?: (context: EvidenceRuleContext) => string | undefined,
): EvidenceAwareRule {
  const legacy = builtInRules.find((rule) => rule.meta.id === id);
  if (!legacy) throw new Error(`Missing built-in rule implementation for ${id}`);
  return {
    meta: inventoryEntry(id),
    async evaluate(context: EvidenceRuleContext) {
      const inconclusiveReason = inconclusive?.(context);
      if (inconclusiveReason) {
        return {
          outcome: "unknown" as const,
          reason: inconclusiveReason,
          reasonCode: "evidence-inconclusive" as const,
        };
      }
      const legacyContext = legacyRuleContext(context);
      const findings: EvidenceRuleFinding[] = [];
      const returned = await legacy.check({
        ...legacyContext,
        report: (value: LegacyFindingInput): void => {
          findings.push(toEvidenceFinding(value));
        },
      });
      if (Array.isArray(returned))
        for (const finding of returned) findings.push(toEvidenceFinding(finding));
      return findings.length > 0
        ? { outcome: "fail" as const, reason: findings[0]!.message, findings }
        : {
            outcome: "pass" as const,
            reason: `Evidence prerequisites passed for ${id}; the V1 compatibility check found no issue.`,
          };
    },
  };
}

/**
 * Run correlateRuntime as the compatibility oracle for one runtime rule when
 * attribution is exact and runtime.trace prerequisites are satisfied.
 */
function runtimeEvidenceRule(id: MigratedRuntimeEvidenceRuleId): EvidenceAwareRule {
  return {
    meta: inventoryEntry(id),
    evaluate(context: EvidenceRuleContext) {
      const traces = context.options.runtimeTraces as RuntimeTraceReport[] | undefined;
      const projects = context.options.runtimeProjects as ProjectFacts[] | undefined;
      if (!traces?.length || !projects?.length) {
        return {
          outcome: "unknown" as const,
          reason: "Runtime trace evidence was not opted in for this analysis.",
          reasonCode: "evidence-inconclusive" as const,
        };
      }
      const traceAssertion = context.evidence.find({
        predicate: "runtime.trace",
        layer: "runtime",
        subjectKind: "runtime-instance",
        minimumConfidence: "high",
        minimumCompleteness: "complete",
      });
      if (traceAssertion.length === 0) {
        const weak = context.evidence.find({
          predicate: "runtime.trace",
          layer: "runtime",
          subjectKind: "runtime-instance",
        });
        if (weak.length === 0) {
          return {
            outcome: "unknown" as const,
            reason: "Required runtime.trace evidence is missing for this subject.",
            reasonCode: "evidence-inconclusive" as const,
          };
        }
        const completeness = weak[0]?.completeness.status;
        if (completeness === "partial" || completeness === "unknown") {
          return {
            outcome: "unknown" as const,
            reason: "Runtime trace evidence is partial or stale.",
            reasonCode: "evidence-inconclusive" as const,
          };
        }
        return {
          outcome: "unknown" as const,
          reason: "Runtime trace attribution is too weak to judge this rule.",
          reasonCode: "evidence-inconclusive" as const,
        };
      }
      const scopedTraces = tracesForSubject(traces, context.subject);
      const exactTraces = scopedTraces.filter(
        (trace) => classifyRuntimeAttribution(trace, projects).exactAttribution,
      );
      if (exactTraces.length === 0) {
        return {
          outcome: "unknown" as const,
          reason: "Runtime trace attribution is ambiguous or weak for this subject.",
          reasonCode: "evidence-inconclusive" as const,
        };
      }
      const findings = correlateRuntime(exactTraces, projects).filter(
        (finding) => finding.ruleId === id,
      );
      if (findings.length === 0) {
        return {
          outcome: "pass" as const,
          reason: `Evidence prerequisites passed for ${id}; runtime correlation found no issue.`,
        };
      }
      const projected = findings.map((finding) =>
        toEvidenceFinding({
          message: finding.message,
          evidence: finding.evidence,
          ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
        }),
      );
      return {
        outcome: "fail" as const,
        reason: projected[0]!.message,
        findings: projected,
      };
    },
  };
}

export const migratedRuntimeEvidenceRules: readonly EvidenceAwareRule[] =
  MIGRATED_GROUP5_RULE_IDS.map((id) => runtimeEvidenceRule(id));

export const migratedEvidenceRules: readonly EvidenceAwareRule[] =
  MIGRATED_STATIC_EVIDENCE_RULE_IDS.map((id) => legacyEvidenceRule(id, inconclusiveFor(id)));

export const migratedEvidenceRuleIds: ReadonlySet<string> = new Set(
  migratedEvidenceRules.map((rule) => rule.meta.id),
);

export const migratedRuntimeEvidenceRuleIds: ReadonlySet<string> = new Set(
  migratedRuntimeEvidenceRules.map((rule) => rule.meta.id),
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
  // Keep the non-persisted declaration bridge available while deriving
  // evidence. The migration uses it only to distinguish an explicit
  // `manifest: false` from a bundler default; it is not emitted as a graph
  // assertion or passed through to persisted v1 facts.
  delete copy.artifacts.records;
  if (copy.federationInstances) {
    const instances = copy.federationInstanceId
      ? copy.federationInstances.filter((instance) => instance.id === copy.federationInstanceId)
      : copy.federationInstances;
    copy.federationInstances = instances.map((instance) => {
      delete instance.artifacts.records;
      return instance;
    });
  }
  return copy;
}

export interface EvidenceBridgeContext {
  root?: string;
  sharedPolicy?: Readonly<Record<string, unknown>>;
  recognizeMfToolkit?: boolean;
}

export interface MigratedEvidenceRun {
  graph: EvidenceGraphV2;
  output: EvidenceRuleRunnerOutput;
}

function ruleOptionsFor(
  settings: Readonly<Record<string, RuleSetting>>,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return Object.fromEntries(
    migratedEvidenceRules.map((rule) => {
      const setting = settings[rule.meta.id];
      return [rule.meta.id, Array.isArray(setting) ? setting[1] : {}];
    }),
  );
}

function runtimeRuleOptionsFor(
  settings: Readonly<Record<string, RuleSetting>>,
  traces: readonly RuntimeTraceReport[],
  projects: readonly ProjectFacts[],
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return Object.fromEntries(
    migratedRuntimeEvidenceRules.map((rule) => {
      const setting = settings[rule.meta.id];
      const options = Array.isArray(setting) ? setting[1] : {};
      return [
        rule.meta.id,
        {
          ...options,
          runtimeTraces: traces,
          runtimeProjects: projects,
        },
      ];
    }),
  );
}

/** Build the v2 view from collected facts and run the migrated slice. */
export async function runMigratedEvidenceRules(
  facts: ProjectFacts,
  settings: Readonly<Record<string, RuleSetting>>,
  analysisBudget?: AnalysisBudgetTracker,
  selectedBuild?: BuildRecord,
  bridgeContext?: EvidenceBridgeContext,
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
    facts: scopedFacts,
    scope,
    ruleOptions: ruleOptionsFor(settings),
    ...(bridgeContext?.root ? { root: bridgeContext.root } : {}),
    ...(bridgeContext?.sharedPolicy ? { sharedPolicy: bridgeContext.sharedPolicy } : {}),
    ...(bridgeContext?.recognizeMfToolkit !== undefined
      ? { recognizeMfToolkit: bridgeContext.recognizeMfToolkit }
      : {}),
    ...(analysisBudget ? { analysisBudget } : {}),
  });
  graph.evaluations = output.evaluations
    .map((evaluation) => graphEvaluationFor(evaluation, graphScope))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { graph, output: { ...output, execution: [...disabled, ...output.execution] } };
}

/** Run Group 5 runtime rules when opted-in runtime traces are attached. */
export async function runMigratedRuntimeEvidenceRules(
  facts: ProjectFacts,
  projects: readonly ProjectFacts[],
  traces: readonly RuntimeTraceReport[],
  settings: Readonly<Record<string, RuleSetting>>,
  analysisBudget?: AnalysisBudgetTracker,
  bridgeContext?: EvidenceBridgeContext,
): Promise<MigratedEvidenceRun> {
  const graph = migrateProjectFacts(
    factsForEvidence(facts),
    analysisBudget ? { analysisBudget } : {},
  );
  attachRuntimeTraceEvidence(graph, traces, projects);
  const scope = evidenceRuleScopeFor(facts);
  const graphScope = applyGraphScope(graph, scope);
  const rules = migratedRuntimeEvidenceRules.filter((rule) => settings[rule.meta.id] !== "off");
  const disabled: RuleExecutionState[] = migratedRuntimeEvidenceRules
    .filter((rule) => settings[rule.meta.id] === "off")
    .map((rule) => ({
      state: "disabled" as const,
      rule: { id: rule.meta.id, version: rule.meta.version },
      reason: 'Rule is disabled by configuration (setting is "off").',
    }));
  const output = await runEvidenceAwareRules({
    graph,
    rules,
    facts,
    scope,
    ruleOptions: runtimeRuleOptionsFor(settings, traces, projects),
    ...(bridgeContext?.root ? { root: bridgeContext.root } : {}),
    ...(bridgeContext?.sharedPolicy ? { sharedPolicy: bridgeContext.sharedPolicy } : {}),
    ...(bridgeContext?.recognizeMfToolkit !== undefined
      ? { recognizeMfToolkit: bridgeContext.recognizeMfToolkit }
      : {}),
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

function attributedProjectFor(
  evaluation: RuleEvaluationResult,
  facts: ProjectFacts,
  subjectById?: ReadonlyMap<string, EvidenceSubject>,
): string {
  const subject = subjectById?.get(evaluation.subject);
  if (subject?.kind === "runtime-instance") {
    const project = subject.attributes?.project;
    if (typeof project === "string") return project;
  }
  return facts.project.name;
}

function attributedFederationInstanceIdFor(
  evaluation: RuleEvaluationResult,
  facts: ProjectFacts,
  subjectById?: ReadonlyMap<string, EvidenceSubject>,
): string | undefined {
  const subject = subjectById?.get(evaluation.subject);
  const fromSubject = subject?.attributes?.federationInstanceId;
  if (typeof fromSubject === "string") return fromSubject;
  return facts.federationInstanceId;
}

/** Project conclusive v2 failures into the existing V1 finding shape. */
export function projectMigratedFailures(
  evaluations: readonly RuleEvaluationResult[],
  facts: ProjectFacts,
  settings: Readonly<Record<string, RuleSetting>>,
  root: string,
  subjects?: readonly EvidenceSubject[],
): DoctorFinding[] {
  const subjectById = subjects
    ? new Map(subjects.map((subject) => [subject.id, subject]))
    : undefined;
  const rules = new Map([
    ...migratedEvidenceRules.map((rule) => [rule.meta.id, rule] as const),
    ...migratedRuntimeEvidenceRules.map((rule) => [rule.meta.id, rule] as const),
  ]);
  const findings: DoctorFinding[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.outcome !== "fail") continue;
    const rule = rules.get(evaluation.rule.id);
    if (!rule) continue;
    const severity = severityFor(settings[evaluation.rule.id], rule.meta.defaultSeverity);
    if (!severity) continue;
    const fallbackFinding: EvidenceRuleFinding = {
      message: evaluation.reason,
      evidence: {},
      ...(rule.meta.remediation.fix ? { suggestion: rule.meta.remediation.fix } : {}),
    };
    const projected: EvidenceRuleFinding[] = evaluation.findings ?? [fallbackFinding];
    const project = attributedProjectFor(evaluation, facts, subjectById);
    const federationInstanceId = attributedFederationInstanceIdFor(evaluation, facts, subjectById);
    for (const finding of projected) {
      const location = finding.location
        ? {
            ...finding.location,
            path: redact(finding.location.path, root) as string,
          }
        : undefined;
      const base = {
        schemaVersion: 1 as const,
        ruleId: evaluation.rule.id,
        severity,
        message: redact(finding.message, root) as string,
        project,
        ...(federationInstanceId ? { federationInstanceId } : {}),
        evidence: redact(finding.evidence, root) as Record<string, unknown>,
        documentation: rule.meta.remediation.documentation,
        ...(location ? { location } : {}),
        ...(finding.suggestion ? { suggestion: redact(finding.suggestion, root) as string } : {}),
      };
      findings.push({
        ...base,
        fingerprint: fingerprint(base),
        ...(finding.detailsSchema ? { detailsSchema: finding.detailsSchema } : {}),
        ...(finding.details
          ? { details: redact(finding.details, root) as Record<string, unknown> }
          : {}),
      });
    }
  }
  return findings;
}
