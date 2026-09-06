import type { AnalysisBudgetTracker, AnalysisBudgetReport } from "./analysis-budgets.js";
import type { EvidenceSubject } from "./evidence.js";
import {
  evaluateFederationWorkspaceOracle,
  type FederationOracleFinding,
  type FederationWorkspaceOracleInput,
} from "./federation-workspace-oracle.js";
import { migrateFederationWorkspace } from "./evidence-reader.js";
import { federationRuleMeta } from "./rules.js";
import { MIGRATED_GROUP4_RULE_IDS, requireRuleInventoryEntry } from "./rule-inventory.js";
import {
  runEvidenceAwareRules,
  type EvidenceAwareRule,
  type EvidenceRuleContext,
  type EvidenceRuleScope,
  type RuleEvaluationResult,
} from "./rule-contract.js";
import type { DoctorFinding, RuleSetting } from "./types.js";
import { redact } from "./utils.js";
import {
  completeEvidenceRun,
  disabledRuleExecution,
  projectConclusiveFailures,
  ruleOptionsFromSettings,
  toEvidenceFinding,
  type EvidenceProjectionRun,
} from "./evidence-graph-projection.js";

export type MigratedFederationEvidenceRuleId = (typeof MIGRATED_GROUP4_RULE_IDS)[number];

function toOracleEvidenceFinding(value: FederationOracleFinding) {
  const suggestion = federationRuleMeta.find((meta) => meta.id === value.ruleId)?.fix;
  return toEvidenceFinding({
    message: value.message,
    evidence: { ...value.evidence, project: value.project },
    ...(suggestion ? { suggestion } : {}),
    ...(value.detailsSchema ? { detailsSchema: value.detailsSchema } : {}),
    ...(value.details ? { details: value.details } : {}),
  });
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
  const subjectInstanceId = subject.attributes?.federationInstanceId ?? undefined;
  return edges.some((edge) => {
    if (!edge || typeof edge !== "object") return false;
    const record = edge as Record<string, unknown>;
    const edgeInstanceId =
      typeof record.fromInstanceId === "string" ? record.fromInstanceId : undefined;
    return (
      record.project === fromProject &&
      record.remote === remoteName &&
      record.alias === alias &&
      edgeInstanceId === subjectInstanceId
    );
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
    meta: requireRuleInventoryEntry(id),
    async evaluate(context: EvidenceRuleContext) {
      const oracleFindings =
        (context.options.oracleFindings as readonly FederationOracleFinding[] | undefined) ?? [];
      const findings = filterOracleFindingsForSubject(oracleFindings, id, context.subject).map(
        toOracleEvidenceFinding,
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

export type MigratedFederationEvidenceRun = EvidenceProjectionRun;

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
  const disabled = disabledRuleExecution(migratedFederationEvidenceRules, settings);
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
    ruleOptions: ruleOptionsFromSettings(
      migratedFederationEvidenceRules,
      settings,
      (_rule, options) => ({ ...options, oracleFindings }),
    ),
    ...(analysisBudget ? { analysisBudget } : {}),
  });
  return completeEvidenceRun(graph, output, graph.scope, disabled);
}

/** Project conclusive v2 federation failures into the existing V1 finding shape. */
export function projectMigratedFederationFailures(
  evaluations: readonly RuleEvaluationResult[],
  settings: Readonly<Record<string, RuleSetting>>,
  root: string,
): DoctorFinding[] {
  const rules = new Map(migratedFederationEvidenceRules.map((rule) => [rule.meta.id, rule]));
  return projectConclusiveFailures({
    evaluations,
    rules,
    settings,
    root,
    uniqueFingerprints: true,
    projectFor: (_evaluation, finding) =>
      redact(
        typeof finding.evidence.project === "string" ? finding.evidence.project : "federation",
        root,
      ) as string,
    evidenceFor: (_evaluation, finding) => {
      const { project: _project, ...evidence } = finding.evidence;
      return evidence;
    },
  });
}
