import type {
  EvidenceGraphV2,
  EvidenceRuleEvaluation,
  EvidenceScope,
  EvidenceValue,
} from "./evidence.js";
import type {
  EvidenceAwareRule,
  EvidenceRuleFinding,
  EvidenceRuleRunnerOutput,
  EvidenceRuleScope,
  RuleEvaluationResult,
  RuleExecutionState,
} from "./rule-contract.js";
import type { DoctorFinding, RuleSetting, Severity } from "./types.js";
import { fingerprint, redact } from "./utils.js";

const GRAPH_TARGETS = new Set<EvidenceScope["target"]>([
  "web",
  "node",
  "browser",
  "ssr",
  "unknown",
]);

export type EvidenceProjectionRun = {
  graph: EvidenceGraphV2;
  output: EvidenceRuleRunnerOutput;
};

export type ProjectableEvidenceRule = Pick<EvidenceAwareRule, "meta">;

export function graphScopeFor(graphScope: EvidenceScope, scope: EvidenceRuleScope): EvidenceScope {
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
    ...(scope.edgeId ? { edgeId: scope.edgeId } : {}),
  };
}

export function graphEvaluationFor(
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

export function severityFor(
  setting: RuleSetting | undefined,
  fallback: Severity,
): Severity | undefined {
  if (setting === "off") return undefined;
  if (setting && typeof setting !== "string") return setting[0];
  return setting ?? fallback;
}

export function disabledRuleExecution(
  rules: readonly ProjectableEvidenceRule[],
  settings: Readonly<Record<string, RuleSetting>>,
): RuleExecutionState[] {
  return rules
    .filter((rule) => settings[rule.meta.id] === "off")
    .map((rule) => ({
      state: "disabled" as const,
      rule: { id: rule.meta.id, version: rule.meta.version },
      reason: 'Rule is disabled by configuration (setting is "off").',
    }));
}

function toEvidenceRecord(value: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([key, item]) => [key, item as EvidenceValue]),
  );
}

export function toEvidenceFinding(value: {
  message: string;
  evidence?: Record<string, unknown>;
  suggestion?: string;
  location?: EvidenceRuleFinding["location"];
  detailsSchema?: string;
  details?: Record<string, unknown>;
}): EvidenceRuleFinding {
  return {
    message: value.message,
    evidence: toEvidenceRecord(value.evidence),
    ...(value.suggestion ? { suggestion: value.suggestion } : {}),
    ...(value.location ? { location: value.location } : {}),
    ...(value.detailsSchema ? { detailsSchema: value.detailsSchema } : {}),
    ...(value.details ? { details: toEvidenceRecord(value.details) } : {}),
  };
}

export function ruleOptionsFromSettings(
  rules: readonly ProjectableEvidenceRule[],
  settings: Readonly<Record<string, RuleSetting>>,
  extra?: (
    rule: ProjectableEvidenceRule,
    options: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>,
) {
  return Object.fromEntries(
    rules.map((rule) => {
      const setting = settings[rule.meta.id];
      const options = Array.isArray(setting) ? setting[1] : {};
      return [rule.meta.id, extra ? extra(rule, options) : options];
    }),
  );
}

export function completeEvidenceRun(
  graph: EvidenceGraphV2,
  output: EvidenceRuleRunnerOutput,
  graphScope: EvidenceScope,
  disabled: readonly RuleExecutionState[],
): EvidenceProjectionRun {
  graph.evaluations = output.evaluations
    .map((evaluation) => graphEvaluationFor(evaluation, graphScope))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { graph, output: { ...output, execution: [...disabled, ...output.execution] } };
}

type FindingMap<T> = (evaluation: RuleEvaluationResult, finding: EvidenceRuleFinding) => T;

export function projectConclusiveFailures(input: {
  evaluations: readonly RuleEvaluationResult[];
  rules: ReadonlyMap<string, ProjectableEvidenceRule>;
  settings: Readonly<Record<string, RuleSetting>>;
  root: string;
  projectFor: FindingMap<string>;
  evidenceFor?: FindingMap<Record<string, unknown>>;
  federationInstanceIdFor?: FindingMap<string | undefined>;
  uniqueFingerprints?: boolean;
}): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const seen = input.uniqueFingerprints ? new Set<string>() : undefined;
  for (const evaluation of input.evaluations) {
    if (evaluation.outcome !== "fail") continue;
    const rule = input.rules.get(evaluation.rule.id);
    if (!rule) continue;
    const severity = severityFor(input.settings[evaluation.rule.id], rule.meta.defaultSeverity);
    if (!severity) continue;
    const projected = evaluation.findings ?? [
      toEvidenceFinding({
        message: evaluation.reason,
        ...(rule.meta.remediation.fix ? { suggestion: rule.meta.remediation.fix } : {}),
      }),
    ];
    for (const finding of projected) {
      const project = input.projectFor(evaluation, finding);
      const federationInstanceId = input.federationInstanceIdFor?.(evaluation, finding);
      const evidence = input.evidenceFor?.(evaluation, finding) ?? finding.evidence;
      const location = finding.location
        ? { ...finding.location, path: redact(finding.location.path, input.root) as string }
        : undefined;
      const base = {
        schemaVersion: 1 as const,
        ruleId: evaluation.rule.id,
        severity,
        message: redact(finding.message, input.root) as string,
        project,
        ...(federationInstanceId ? { federationInstanceId } : {}),
        evidence: redact(evidence, input.root) as Record<string, unknown>,
        documentation: rule.meta.remediation.documentation,
        ...(location ? { location } : {}),
        ...(finding.suggestion
          ? { suggestion: redact(finding.suggestion, input.root) as string }
          : {}),
      };
      const next: DoctorFinding = {
        ...base,
        fingerprint: fingerprint(base),
        ...(finding.detailsSchema ? { detailsSchema: finding.detailsSchema } : {}),
        ...(finding.details
          ? { details: redact(finding.details, input.root) as Record<string, unknown> }
          : {}),
      };
      if (seen) {
        if (seen.has(next.fingerprint)) continue;
        seen.add(next.fingerprint);
      }
      findings.push(next);
    }
  }
  return findings;
}
