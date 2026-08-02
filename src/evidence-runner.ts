import {
  normalizeEvidenceGraph,
  type EvidenceAssertion,
  type EvidenceCompleteness,
  type EvidenceConfidence,
  type EvidenceGraphV2,
  type EvidenceSubject,
} from "./evidence.js";
import {
  capConfidence,
  stableEvaluationId,
  weakestConfidence,
  type EvidenceAwareRule,
  type EvidenceQuery,
  type EvidenceRequirement,
  type EvidenceRuleContext,
  type EvidenceRuleRunnerInput,
  type EvidenceRuleRunnerOutput,
  type EvidenceRuleScope,
  type EvidenceSelector,
  type RuleExecutionState,
  type RuleEvaluationResult,
} from "./rule-contract.js";
import { deepFreeze } from "./utils.js";

const CONFIDENCE: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3, exact: 4 };
const COMPLETENESS: Record<EvidenceCompleteness, number> = {
  "not-collected": 0,
  unknown: 1,
  partial: 2,
  complete: 3,
};

function selectorMatches(
  assertion: EvidenceAssertion,
  selector: EvidenceSelector,
  subjects: ReadonlyMap<string, EvidenceSubject>,
): boolean {
  return (
    assertion.predicate === selector.predicate &&
    (selector.layer === undefined || assertion.layer === selector.layer) &&
    (selector.subjectKind === undefined ||
      subjects.get(assertion.subject)?.kind === selector.subjectKind) &&
    (selector.minimumConfidence === undefined ||
      CONFIDENCE[assertion.confidence.level]! >= CONFIDENCE[selector.minimumConfidence]!) &&
    (selector.minimumCompleteness === undefined ||
      COMPLETENESS[assertion.completeness.status] >= COMPLETENESS[selector.minimumCompleteness])
  );
}

function queryFor(graph: EvidenceGraphV2, subjectId?: string): EvidenceQuery {
  const subjects = new Map(graph.subjects.map((subject) => [subject.id, subject] as const));
  const assertions = graph.assertions.filter(
    (assertion) => !subjectId || assertion.subject === subjectId,
  );
  const view: EvidenceQuery = {
    assertions,
    find(selector) {
      return assertions.filter((assertion) => selectorMatches(assertion, selector, subjects));
    },
    forSubject(nextSubjectId) {
      return queryFor(graph, nextSubjectId);
    },
  };
  return deepFreeze(view);
}

function requirementState(
  requirement: EvidenceRequirement,
  query: EvidenceQuery,
): {
  ok: boolean;
  ids: string[];
  missing: EvidenceRequirement[];
  confidence: EvidenceConfidence;
  completeness: EvidenceCompleteness;
} {
  if ("predicate" in requirement) {
    const candidates = query.assertions.filter(
      (assertion) => assertion.predicate === requirement.predicate,
    );
    const matches = query.find(requirement);
    if (matches.length > 0) {
      return {
        ok: true,
        ids: matches.map((assertion) => assertion.id),
        missing: [],
        confidence: matches.reduce<EvidenceConfidence>(
          (weak, item) => weakestConfidence(weak, item.confidence.level),
          "exact",
        ),
        completeness: matches.reduce(
          (weak, item) =>
            COMPLETENESS[item.completeness.status] < COMPLETENESS[weak]
              ? item.completeness.status
              : weak,
          "complete" as EvidenceCompleteness,
        ),
      };
    }
    return {
      ok: false,
      ids: [],
      missing: [requirement],
      confidence:
        candidates.find((candidate) => candidate.confidence.level !== "unknown")?.confidence
          .level ?? "unknown",
      completeness: candidates[0]?.completeness.status ?? "not-collected",
    };
  }
  const children = ("allOf" in requirement ? requirement.allOf : requirement.anyOf).map((child) =>
    requirementState(child, query),
  );
  const isAny = "anyOf" in requirement;
  const selected = isAny ? children.find((child) => child.ok) : undefined;
  if (isAny && selected) return selected;
  const ok = isAny ? false : children.every((child) => child.ok);
  return {
    ok,
    ids: children.flatMap((child) => child.ids),
    missing: children.flatMap((child) => child.missing),
    confidence: children.reduce<EvidenceConfidence>(
      (weak, child) => weakestConfidence(weak, child.confidence),
      "exact",
    ),
    completeness: children.reduce(
      (weak, child) =>
        COMPLETENESS[child.completeness] < COMPLETENESS[weak] ? child.completeness : weak,
      "complete" as EvidenceCompleteness,
    ),
  };
}

function known(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "unknown";
}

function applicability(
  rule: EvidenceAwareRule,
  scope: EvidenceRuleScope,
): "yes" | "no" | "unknown" {
  const checks: Array<
    [
      string | undefined,
      string | undefined,
      Array<{ name: string; version?: string }> | string[] | undefined,
    ]
  > = [
    [scope.adapter, undefined, rule.meta.applicability.adapters],
    [scope.bundler?.name, scope.bundler?.version, rule.meta.applicability.bundlers],
    [scope.target, undefined, rule.meta.applicability.targets],
    [scope.buildMode, undefined, rule.meta.applicability.buildModes],
    [scope.projectRole, undefined, rule.meta.applicability.projectRoles],
  ];
  let uncertain = false;
  for (const [value, version, allowed] of checks) {
    if (!allowed || allowed.length === 0) continue;
    if (!known(value)) {
      uncertain = true;
      continue;
    }
    const matching = allowed.filter(
      (item) => (typeof item === "string" ? item : item.name) === value,
    );
    if (matching.length === 0) return "no";
    const versioned = matching.find(
      (item) => typeof item !== "string" && item.version !== undefined,
    );
    const versionConstraint = typeof versioned === "string" ? undefined : versioned?.version;
    if (versionConstraint !== undefined && !known(version)) uncertain = true;
    else if (versionConstraint !== undefined && versionConstraint !== version) return "no";
  }
  return uncertain ? "unknown" : "yes";
}

function evaluationBase(
  rule: EvidenceAwareRule,
  subject: EvidenceSubject,
  graph: EvidenceGraphV2,
  scope: EvidenceRuleScope,
) {
  return {
    id: stableEvaluationId({
      ruleId: rule.meta.id,
      ruleVersion: rule.meta.version,
      subjectId: subject.id,
      scope: { ...graph.identity, project: graph.identity.project ?? subject.id },
    }),
    rule: { id: rule.meta.id, version: rule.meta.version },
    subject: subject.id,
    scope,
  };
}

export async function runEvidenceAwareRules(
  input: EvidenceRuleRunnerInput,
): Promise<EvidenceRuleRunnerOutput> {
  const graph = deepFreeze(normalizeEvidenceGraph(input.graph));
  const subjects = graph.subjects.filter(
    (subject) => !input.subjects || input.subjects.includes(subject.id),
  );
  const scope = {
    adapter: graph.scope.adapter,
    bundler: graph.scope.bundler,
    target: graph.scope.target,
    ...input.scope,
  };
  const evaluations: RuleEvaluationResult[] = [];
  const execution: RuleExecutionState[] = [];
  const seen = new Set<string>();
  for (const rule of input.rules)
    for (const subject of subjects) {
      const base = evaluationBase(rule, subject, graph, scope);
      if (seen.has(base.id)) {
        execution.push({
          state: "engine-error",
          rule: base.rule,
          reason: "duplicate evaluation identity",
          error: base.id,
        });
        continue;
      }
      seen.add(base.id);
      const query = queryFor(graph, subject.id);
      const applicable = applicability(rule, scope);
      if (applicable !== "yes") {
        const unknown = applicable === "unknown";
        if (unknown) {
          evaluations.push({
            ...base,
            evidenceIds: [],
            outcome: "unknown",
            reasonCode: "applicability-unknown",
            reason: "Applicability is not proven by the evidence scope.",
            confidence: "unknown",
            completeness: "unknown",
            missingRequirements: [],
          });
        } else {
          evaluations.push({
            ...base,
            evidenceIds: [],
            outcome: "not-applicable",
            reasonCode: "not-applicable",
            reason: "Rule is not applicable to this known scope.",
            confidence: "unknown",
            completeness: "unknown",
          });
        }
        continue;
      }
      const prerequisite = requirementState(rule.meta.prerequisites, query);
      const confidence = capConfidence(
        prerequisite.confidence as never,
        rule.meta.confidenceCeiling,
      );
      if (
        !prerequisite.ok ||
        confidence === "unknown" ||
        prerequisite.completeness !== "complete"
      ) {
        const reasonCode = !prerequisite.ok
          ? prerequisite.completeness === "partial"
            ? "prerequisite-incomplete"
            : "prerequisite-missing"
          : confidence === "unknown"
            ? "prerequisite-below-confidence"
            : "prerequisite-incomplete";
        evaluations.push({
          ...base,
          evidenceIds: prerequisite.ids,
          outcome: "unknown",
          reasonCode,
          reason: "Required evidence is missing, incomplete, or too weak to judge.",
          confidence,
          completeness: prerequisite.completeness,
          missingRequirements: prerequisite.missing,
        });
        continue;
      }
      try {
        const context: EvidenceRuleContext = deepFreeze({
          subject,
          scope: deepFreeze(scope),
          evidenceIds: Object.freeze(prerequisite.ids.slice()),
          evidence: query,
        });
        const decision = await rule.evaluate(context);
        if (decision.outcome !== "pass" && decision.outcome !== "fail")
          throw new Error("Rule returned an invalid outcome.");
        evaluations.push({
          ...base,
          outcome: decision.outcome,
          reasonCode: "rule-result",
          reason: decision.reason,
          evidenceIds: prerequisite.ids,
          confidence: confidence as Exclude<typeof confidence, "unknown">,
          completeness: "complete",
        } as RuleEvaluationResult);
      } catch (error) {
        execution.push({
          state: "engine-error",
          rule: base.rule,
          reason: "Rule evaluation threw an exception.",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  return { evaluations, execution };
}
