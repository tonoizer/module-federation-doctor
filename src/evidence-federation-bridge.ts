import type { AnalysisBudgetTracker, AnalysisBudgetReport } from "./analysis-budgets.js";
import type {
  EvidenceGraphV2,
  EvidenceRuleEvaluation,
  EvidenceScope,
  EvidenceValue,
} from "./evidence.js";
import {
  evaluateFederationWorkspaceOracle,
  type FederationOracleFinding,
  type FederationWorkspaceOracleInput,
} from "./federation-workspace-oracle.js";
import { migrateFederationWorkspace } from "./evidence-reader.js";
import { federationRuleMeta } from "./rules.js";
import { MIGRATED_GROUP4_RULE_IDS, ruleInventory } from "./rule-inventory.js";
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
import type { DoctorFinding, RuleSetting, Severity } from "./types.js";
import { fingerprint, redact } from "./utils.js";

export type MigratedFederationEvidenceRuleId = (typeof MIGRATED_GROUP4_RULE_IDS)[number];

const ABSENCE_SENSITIVE_RULE_IDS = new Set<string>([
  "federation/missing-provider",
  "federation/host-gaps",
  "federation/ghost-shares",
  "federation/external-runtime-provider-missing",
]);

function inventoryEntry(id: string) {
  const entry = ruleInventory.find((item) => item.id === id);
  if (!entry) throw new Error(`Missing evidence-aware inventory entry for ${id}`);
  return entry;
}

function toEvidenceFinding(value: FederationOracleFinding): EvidenceRuleFinding {
  const finding: EvidenceRuleFinding = {
    message: value.message,
    evidence: {
      ...Object.fromEntries(
        Object.entries(value.evidence).map(([key, item]) => [key, item as EvidenceValue]),
      ),
      project: value.project,
    },
    ...(value.detailsSchema ? { detailsSchema: value.detailsSchema } : {}),
    ...(value.details
      ? {
          details: Object.fromEntries(
            Object.entries(value.details).map(([key, item]) => [key, item as EvidenceValue]),
          ),
        }
      : {}),
  };
  const suggestion = federationRuleMeta.find((meta) => meta.id === value.ruleId)?.fix;
  if (suggestion) finding.suggestion = suggestion;
  return finding;
}

function federationEvidenceRule(id: MigratedFederationEvidenceRuleId): EvidenceAwareRule {
  return {
    meta: inventoryEntry(id),
    async evaluate(context: EvidenceRuleContext) {
      const oracleInput = context.options.oracleInput as FederationWorkspaceOracleInput | undefined;
      if (!oracleInput) {
        return {
          outcome: "unknown" as const,
          reason: "Federation workspace oracle input is missing.",
          reasonCode: "evidence-inconclusive" as const,
        };
      }
      const findings = evaluateFederationWorkspaceOracle(oracleInput)
        .filter((finding) => finding.ruleId === id)
        .map(toEvidenceFinding);
      return findings.length > 0
        ? { outcome: "fail" as const, reason: findings[0]!.message, findings }
        : {
            outcome: "pass" as const,
            reason: `Evidence prerequisites passed for ${id}; the federation workspace check found no issue.`,
          };
    },
  };
}

export const migratedFederationEvidenceRules: readonly EvidenceAwareRule[] =
  MIGRATED_GROUP4_RULE_IDS.map((id) => federationEvidenceRule(id));

export const migratedFederationEvidenceRuleIds: ReadonlySet<string> = new Set(
  migratedFederationEvidenceRules.map((rule) => rule.meta.id),
);

export interface FederationEvidenceBridgeInput {
  projects: readonly import("./types.js").ProjectFacts[];
  groupKey: string;
  workspaceAnalysis?: AnalysisBudgetReport;
  groupEvidenceIncomplete: boolean;
  alwaysShared: ReadonlySet<string>;
}

export interface MigratedFederationEvidenceRun {
  graph: EvidenceGraphV2;
  output: EvidenceRuleRunnerOutput;
}

function graphScopeFor(graphScope: EvidenceScope, scope: EvidenceRuleScope): EvidenceScope {
  return {
    ...graphScope,
    ...(scope.adapter ? { adapter: scope.adapter } : {}),
    target: graphScope.target,
    ...(scope.buildMode ? { buildMode: scope.buildMode } : {}),
    ...(scope.projectRole ? { projectRole: scope.projectRole } : {}),
  };
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

function ruleOptionsFor(
  settings: Readonly<Record<string, RuleSetting>>,
  oracleInput: FederationWorkspaceOracleInput,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return Object.fromEntries(
    migratedFederationEvidenceRules.map((rule) => {
      const setting = settings[rule.meta.id];
      const options = Array.isArray(setting) ? setting[1] : {};
      return [rule.meta.id, { ...options, oracleInput }];
    }),
  );
}

export async function runMigratedFederationRules(
  input: FederationEvidenceBridgeInput,
  settings: Readonly<Record<string, RuleSetting>>,
  analysisBudget?: AnalysisBudgetTracker,
): Promise<MigratedFederationEvidenceRun> {
  const graph = migrateFederationWorkspace(
    {
      projects: input.projects,
      groupKey: input.groupKey,
      groupEvidenceIncomplete: input.groupEvidenceIncomplete,
      ...(input.workspaceAnalysis ? { workspaceAnalysis: input.workspaceAnalysis } : {}),
    },
    analysisBudget ? { analysisBudget } : {},
  );
  const representativeBundler = input.projects[0]?.bundler.name ?? "unknown";
  const workspaceName = input.groupKey === "\0ungrouped" ? "workspace" : input.groupKey;
  const workspaceSubject = graph.subjects.find(
    (subject) => subject.kind === "project" && subject.name === workspaceName,
  );
  if (!workspaceSubject) throw new Error("Federation workspace subject is missing from the graph.");
  const scope: EvidenceRuleScope = {
    adapter: representativeBundler,
    bundler: { name: representativeBundler },
    target: "unknown",
  };
  graph.scope = {
    ...graph.scope,
    adapter: representativeBundler,
    bundler: { name: representativeBundler },
    target: "unknown",
  };
  graph.identity = { ...graph.identity, workspace: input.groupKey };
  const oracleInput: FederationWorkspaceOracleInput = {
    projectGroup: input.projects,
    groupEvidenceIncomplete: input.groupEvidenceIncomplete,
    alwaysShared: input.alwaysShared,
  };
  const rules = migratedFederationEvidenceRules.filter((rule) => settings[rule.meta.id] !== "off");
  const disabled: RuleExecutionState[] = migratedFederationEvidenceRules
    .filter((rule) => settings[rule.meta.id] === "off")
    .map((rule) => ({
      state: "disabled" as const,
      rule: { id: rule.meta.id, version: rule.meta.version },
      reason: 'Rule is disabled by configuration (setting is "off").',
    }));
  const output = await runEvidenceAwareRules({
    graph,
    rules,
    subjects: [workspaceSubject.id],
    scope,
    ruleOptions: ruleOptionsFor(settings, oracleInput),
    ...(analysisBudget ? { analysisBudget } : {}),
  });
  graph.evaluations = output.evaluations
    .map((evaluation) => graphEvaluationFor(evaluation, graph.scope))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { graph, output: { ...output, execution: [...disabled, ...output.execution] } };
}

function severityFor(setting: RuleSetting | undefined, fallback: Severity): Severity | undefined {
  if (setting === "off") return undefined;
  if (setting && typeof setting !== "string") return setting[0];
  return setting ?? fallback;
}

/** Project conclusive v2 federation failures into the existing V1 finding shape. */
export function projectMigratedFederationFailures(
  evaluations: readonly RuleEvaluationResult[],
  settings: Readonly<Record<string, RuleSetting>>,
  root: string,
): DoctorFinding[] {
  const rules = new Map(migratedFederationEvidenceRules.map((rule) => [rule.meta.id, rule]));
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
    for (const finding of projected) {
      const project =
        typeof finding.evidence.project === "string" ? finding.evidence.project : "federation";
      const location = finding.location
        ? {
            ...finding.location,
            path: redact(finding.location.path, root) as string,
          }
        : undefined;
      const { project: _project, ...evidence } = finding.evidence;
      const base = {
        schemaVersion: 1 as const,
        ruleId: evaluation.rule.id,
        severity,
        message: redact(finding.message, root) as string,
        project: redact(project, root) as string,
        evidence: redact(evidence, root) as Record<string, unknown>,
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

export function isAbsenceSensitiveFederationRule(ruleId: string): boolean {
  return ABSENCE_SENSITIVE_RULE_IDS.has(ruleId);
}
