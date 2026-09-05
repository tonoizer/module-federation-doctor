import type { EvidenceRuleEvaluation, EvidenceScope, EvidenceValue } from "./evidence.js";
import type {
  EvidenceAwareRule,
  EvidenceRuleScope,
  RuleEvaluationResult,
  RuleExecutionState,
} from "./rule-contract.js";
import type { RuleSetting, Severity } from "./types.js";

const GRAPH_TARGETS = new Set<EvidenceScope["target"]>([
  "web",
  "node",
  "browser",
  "ssr",
  "unknown",
]);

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
  rules: readonly EvidenceAwareRule[],
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
