import type { AnalysisBudgetTracker, AnalysisBudgetReport } from "./analysis-budgets.js";
import type {
  EvidenceGraphV2,
  EvidenceRuleEvaluation,
  EvidenceScope,
  EvidenceSubject,
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

function packageNameForSubject(subject: EvidenceSubject): string {
  const fromAttributes = subject.attributes?.package;
  return typeof fromAttributes === "string" ? fromAttributes : subject.name;
}

function remoteEdgeMatchesFinding(
  subject: EvidenceSubject,
  finding: FederationOracleFinding,
): boolean {
  if (finding.ruleId !== "federation/circular-remote-graph") return false;
  const edges = finding.evidence.edges;
  if (!Array.isArray(edges)) return false;
  const fromProject = subject.attributes?.fromProject;
  const remoteName = subject.attributes?.remoteName;
  const alias = subject.attributes?.alias;
  return edges.some((edge) => {
    if (!edge || typeof edge !== "object") return false;
    const record = edge as Record<string, unknown>;
    return record.project === fromProject && record.remote === remoteName && record.alias === alias;
  });
}

function filterOracleFindingsForSubject(
  findings: readonly FederationOracleFinding[],
  ruleId: string,
  subject: EvidenceSubject,
): FederationOracleFinding[] {
  const ruleFindings = findings.filter((finding) => finding.ruleId === ruleId);
  if (subject.kind === "project") return ruleFindings;
  if (subject.kind === "shared-package") {
    const pkg = packageNameForSubject(subject);
    return ruleFindings.filter((finding) => finding.evidence.package === pkg);
  }
  if (subject.kind === "remote") {
    return ruleFindings.filter((finding) => remoteEdgeMatchesFinding(subject, finding));
  }
  return [];
}

function federationEvidenceRule(id: MigratedFederationEvidenceRuleId): EvidenceAwareRule {
  return {
    meta: inventoryEntry(id),
    async evaluate(context: EvidenceRuleContext) {
      const oracleFindings =
        (context.options.oracleFindings as readonly FederationOracleFinding[] | undefined) ?? [];
      const findings = filterOracleFindingsForSubject(oracleFindings, id, context.subject).map(
        toEvidenceFinding,
      );
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
  oracleFindings: readonly FederationOracleFinding[],
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return Object.fromEntries(
    migratedFederationEvidenceRules.map((rule) => {
      const setting = settings[rule.meta.id];
      const options = Array.isArray(setting) ? setting[1] : {};
      return [rule.meta.id, { ...options, oracleFindings }];
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
  if (
    !graph.subjects.some((subject) => subject.kind === "project" && subject.name === workspaceName)
  ) {
    throw new Error("Federation workspace subject is missing from the graph.");
  }
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
  const oracleFindings = evaluateFederationWorkspaceOracle(oracleInput);
  const rules = migratedFederationEvidenceRules.filter((rule) => settings[rule.meta.id] !== "off");
  const disabled: RuleExecutionState[] = migratedFederationEvidenceRules
    .filter((rule) => settings[rule.meta.id] === "off")
    .map((rule) => ({
      state: "disabled" as const,
      rule: { id: rule.meta.id, version: rule.meta.version },
      reason: 'Rule is disabled by configuration (setting is "off").',
    }));
  const evaluationSubjectIds = graph.subjects
    .filter(
      (subject) =>
        subject.kind === "shared-package" ||
        subject.kind === "remote" ||
        (subject.kind === "project" && subject.name === workspaceName),
    )
    .map((subject) => subject.id);
  const output = await runEvidenceAwareRules({
    graph,
    rules,
    subjects: evaluationSubjectIds,
    scope,
    ruleOptions: ruleOptionsFor(settings, oracleFindings),
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
  const seenFingerprints = new Set<string>();
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
      const projectedFingerprint = findings[findings.length - 1]!.fingerprint;
      if (seenFingerprints.has(projectedFingerprint)) findings.pop();
      else seenFingerprints.add(projectedFingerprint);
    }
  }
  return findings;
}
