import {
  normalizeEvidenceGraph,
  type EvidenceAssertion,
  type EvidenceCompleteness,
  type EvidenceConfidence,
  type EvidenceGraphV2,
  type EvidenceSubject,
} from "./evidence.js";
import { EvidenceBudgetExceededError } from "./evidence-budget.js";
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
import semver from "semver";

const CONFIDENCE: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3, exact: 4 };
const COMPLETENESS: Record<EvidenceCompleteness, number> = {
  "not-collected": 0,
  unknown: 1,
  partial: 2,
  complete: 3,
};

function graphPredicateFor(predicate: string): string {
  if (predicate === "config.declared") return "project.moduleFederation";
  if (predicate === "source.scan") return "project.imports";
  if (predicate === "imports.sourceScan") return "imports.sourceScan";
  if (predicate === "moduleFederation") return "project.moduleFederation";
  if (predicate === "runtimePluginContracts") return "project.runtimePluginContracts";
  if (predicate.startsWith("bundler."))
    return `project.bundler.${predicate.slice("bundler.".length)}`;
  const root = predicate.split(".")[0];
  if (["bundler", "capabilities", "dependencies", "imports", "artifacts", "builds"].includes(root!))
    return `project.${root}`;
  return predicate;
}

function predicateMatches(assertion: EvidenceAssertion, predicate: string): boolean {
  return assertion.predicate === predicate || assertion.predicate === graphPredicateFor(predicate);
}

function selectorMatches(
  assertion: EvidenceAssertion,
  selector: EvidenceSelector,
  subjects: ReadonlyMap<string, EvidenceSubject>,
): boolean {
  return (
    predicateMatches(assertion, selector.predicate) &&
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

interface SubjectKindConstraint {
  /** True when the requirement can be satisfied without a subject-kind constraint. */
  unconstrained: boolean;
  /** Subject kinds that can satisfy the constrained branches. */
  kinds: Set<EvidenceSubject["kind"]>;
}

function subjectKindConstraintForRequirement(
  requirement: EvidenceRequirement,
): SubjectKindConstraint {
  if ("predicate" in requirement) {
    return requirement.subjectKind
      ? { unconstrained: false, kinds: new Set([requirement.subjectKind]) }
      : { unconstrained: true, kinds: new Set() };
  }

  if ("allOf" in requirement) {
    let constraint: SubjectKindConstraint = { unconstrained: true, kinds: new Set() };
    for (const child of requirement.allOf) {
      const childConstraint = subjectKindConstraintForRequirement(child);
      // An unconstrained allOf branch imposes no restriction; the other
      // branches still determine the possible subject kinds.
      if (childConstraint.unconstrained) continue;
      if (constraint.unconstrained) {
        constraint = {
          unconstrained: false,
          kinds: new Set(childConstraint.kinds),
        };
        continue;
      }
      constraint = {
        unconstrained: false,
        kinds: new Set([...constraint.kinds].filter((kind) => childConstraint.kinds.has(kind))),
      };
    }
    return constraint;
  }

  const kinds = new Set<EvidenceSubject["kind"]>();
  for (const child of requirement.anyOf) {
    const childConstraint = subjectKindConstraintForRequirement(child);
    // One unconstrained anyOf branch makes every subject kind eligible.
    if (childConstraint.unconstrained) return { unconstrained: true, kinds: new Set() };
    for (const kind of childConstraint.kinds) kinds.add(kind);
  }
  return { unconstrained: false, kinds };
}

function subjectKindForRule(rule: EvidenceAwareRule): EvidenceSubject["kind"] | undefined {
  const constraint = subjectKindConstraintForRequirement(rule.meta.prerequisites);
  return !constraint.unconstrained && constraint.kinds.size === 1
    ? [...constraint.kinds][0]
    : undefined;
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
    const candidates = query.assertions.filter((assertion) =>
      predicateMatches(assertion, requirement.predicate),
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
    [scope.adapter, scope.adapterVersion, rule.meta.applicability.adapters],
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
    const versioned = matching.filter(
      (item): item is { name: string; version: string } =>
        typeof item !== "string" && item.version !== undefined,
    );
    // An unversioned entry is an unconditional match for this name. Otherwise
    // all versioned entries participate: any satisfied range is sufficient.
    if (versioned.length === 0) continue;
    if (matching.some((item) => typeof item === "string" || item.version === undefined)) continue;
    if (!known(version)) {
      uncertain = true;
      continue;
    }
    const actualVersion = semver.valid(version);
    if (!actualVersion) {
      uncertain = true;
      continue;
    }
    let invalidRange = false;
    let satisfied = false;
    for (const candidate of versioned) {
      const range = semver.validRange(candidate.version);
      if (!range) {
        invalidRange = true;
        continue;
      }
      if (semver.satisfies(actualVersion, range)) {
        satisfied = true;
        break;
      }
    }
    if (satisfied) continue;
    if (invalidRange) {
      uncertain = true;
      continue;
    }
    return "no";
  }
  return uncertain ? "unknown" : "yes";
}

function evaluationBase(
  rule: EvidenceAwareRule,
  subject: EvidenceSubject,
  graph: Pick<EvidenceGraphV2, "identity">,
  scope: EvidenceRuleScope,
) {
  return {
    id: stableEvaluationId({
      ruleId: rule.meta.id,
      ruleVersion: rule.meta.version,
      subjectId: subject.id,
      scope: {
        ...graph.identity,
        project: graph.identity.project ?? subject.id,
        ...scope,
      },
    }),
    rule: { id: rule.meta.id, version: rule.meta.version },
    subject: subject.id,
    scope,
  };
}

const SAFE_ADAPTERS = new Set(["modern", "rsbuild", "rspack", "vite", "webpack"]);
const SAFE_BUNDLERS = new Set(["modern", "rsbuild", "rspack", "vite", "webpack"]);
const SAFE_TARGETS = new Set(["web", "node", "browser", "ssr", "unknown"]);
const MAX_FALLBACK_EVALUATIONS = 10_000;

function safeEnum(value: unknown, allowed: ReadonlySet<string>): string {
  return typeof value === "string" && allowed.has(value) ? value : "unknown";
}

function safeFallbackScope(input: EvidenceRuleRunnerInput): EvidenceRuleScope {
  const graphScope = input.graph.scope;
  const override = input.scope;
  return {
    adapter: safeEnum(override?.adapter ?? graphScope.adapter, SAFE_ADAPTERS),
    ...(override?.adapterVersion ? { adapterVersion: "unknown" } : {}),
    bundler: {
      name: safeEnum(override?.bundler?.name ?? graphScope.bundler.name, SAFE_BUNDLERS),
    },
    target: safeEnum(override?.target ?? graphScope.target, SAFE_TARGETS),
  };
}

function opaqueSubjectId(index: number): string {
  return `budget-subject:${index + 1}`;
}

function budgetUnknownEvaluation(
  base: ReturnType<typeof evaluationBase>,
  reason: string,
): RuleEvaluationResult {
  return {
    ...base,
    evidenceIds: [],
    outcome: "unknown",
    reasonCode: "prerequisite-incomplete",
    reason,
    confidence: "unknown",
    completeness: "partial",
    missingRequirements: [],
  };
}

export async function runEvidenceAwareRules(
  input: EvidenceRuleRunnerInput,
): Promise<EvidenceRuleRunnerOutput> {
  let graph: EvidenceGraphV2;
  try {
    graph = deepFreeze(normalizeEvidenceGraph(input.graph, undefined, input.analysisBudget));
  } catch (error) {
    if (!(error instanceof EvidenceBudgetExceededError)) throw error;
    const subjects = input.graph.subjects
      .map((subject, index) => ({
        originalId: typeof subject.id === "string" ? subject.id : undefined,
        inputIndex: index,
      }))
      .filter(
        (subject) =>
          !input.subjects ||
          (subject.originalId !== undefined && input.subjects.includes(subject.originalId)),
      )
      .sort(
        (left, right) =>
          (left.originalId ?? "").localeCompare(right.originalId ?? "") ||
          left.inputIndex - right.inputIndex,
      )
      .map((_subject, index) => ({
        safe: {
          id: opaqueSubjectId(index),
          kind: "project" as const,
          name: "[redacted-subject]",
        },
      }));
    const scope = safeFallbackScope(input);
    const safeGraph: Pick<EvidenceGraphV2, "identity"> = { identity: {} };
    const evaluations: RuleEvaluationResult[] = [];
    for (const rule of input.rules) {
      for (const subject of subjects) {
        if (evaluations.length >= MAX_FALLBACK_EVALUATIONS) break;
        const base = evaluationBase(rule, subject.safe, safeGraph, scope);
        evaluations.push(
          budgetUnknownEvaluation(base, "Evidence analysis was clipped by an analysis budget."),
        );
      }
      if (evaluations.length >= MAX_FALLBACK_EVALUATIONS) break;
    }
    return { evaluations, execution: [], analysis: error.report };
  }
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
  for (const rule of input.rules) {
    const subjectKind = subjectKindForRule(rule);
    const ruleSubjects = subjectKind
      ? subjects.filter((subject) => subject.kind === subjectKind)
      : subjects;
    for (const subject of ruleSubjects) {
      const base = evaluationBase(rule, subject, graph, scope);
      if (input.analysisBudget && !input.analysisBudget.checkWallTime()) {
        evaluations.push(
          budgetUnknownEvaluation(base, "Rule evaluation was clipped by the wall-time budget."),
        );
        continue;
      }
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
          ...(input.facts ? { facts: deepFreeze(structuredClone(input.facts)) } : {}),
          options: deepFreeze(Object.freeze(input.ruleOptions?.[rule.meta.id] ?? {})),
          ...(input.root ? { root: input.root } : {}),
          ...(input.sharedPolicy ? { sharedPolicy: input.sharedPolicy } : {}),
          ...(input.recognizeMfToolkit !== undefined
            ? { recognizeMfToolkit: input.recognizeMfToolkit }
            : {}),
        });
        const decision = await rule.evaluate(context);
        if (input.analysisBudget && !input.analysisBudget.checkWallTime()) {
          evaluations.push(
            budgetUnknownEvaluation(base, "Rule evaluation was clipped by the wall-time budget."),
          );
          continue;
        }
        if (decision.outcome === "unknown") {
          evaluations.push({
            ...base,
            outcome: "unknown",
            reasonCode: decision.reasonCode ?? "evidence-inconclusive",
            reason: decision.reason,
            evidenceIds: prerequisite.ids,
            confidence,
            completeness: prerequisite.completeness,
            missingRequirements: [],
          });
          continue;
        }
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
          ...(decision.findings ? { findings: decision.findings } : {}),
        } as RuleEvaluationResult);
      } catch (error) {
        if (input.analysisBudget && !input.analysisBudget.checkWallTime()) {
          evaluations.push(
            budgetUnknownEvaluation(base, "Rule evaluation was clipped by the wall-time budget."),
          );
          continue;
        }
        execution.push({
          state: "engine-error",
          rule: base.rule,
          reason: "Rule evaluation threw an exception.",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return {
    evaluations,
    execution,
    ...(input.analysisBudget ? { analysis: input.analysisBudget.report() } : {}),
  };
}
